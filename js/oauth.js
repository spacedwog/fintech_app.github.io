// ===============================
// frontend/js/oauth.js
// OAuth 2.0 PRÓPRIO (Authorization Code Grant + PKCE, RFC 6749 + RFC 7636),
// implementado do zero e rodando 100% no navegador — não é "Entrar com o
// Google/Facebook" (não delega a nenhum provedor terceiro): este arquivo É
// o "authorization server", o emissor/validador de tokens e o cliente,
// tudo junto, para um app sem backend (GitHub Pages).
//
// Por que isso importa e qual o limite honesto disso:
// - Segue de verdade a mecânica do protocolo: authorization code de uso
//   único, PKCE (code_verifier/code_challenge S256) para amarrar o code a
//   quem o pediu, tokens JWT (HS256) assinados, access_token de vida curta
//   (1h) + refresh_token de vida longa (30 dias) com rotação e revogação.
// - MAS, como não existe servidor, a chave de assinatura HMAC vive no
//   próprio navegador (gerada uma vez por instalação e guardada em
//   localStorage — ver OAuthSecretStore). Isso significa que, assim como o
//   hash de senha em js/crypto-utils.js e o "banco" em js/db.js, isto não é
//   uma fronteira de segurança real contra alguém com acesso a ESTE
//   navegador: é a implementação didaticamente correta do protocolo,
//   adaptada com transparência às limitações de um app 100% client-side.
//
// Reescrito em POO (mesmo espírito do resto do projeto):
// - OAuthCrypto: base64url, SHA-256, HMAC-SHA256, geradores aleatórios.
// - PKCE (dentro de OAuthCrypto): code_verifier/code_challenge (S256).
// - JwtService: assina/verifica/decodifica tokens JWT (HS256).
// - OAuthSecretStore: chave HMAC persistida por instalação (localStorage).
// - AuthorizationCodeStore: "authorization codes" de uso único, com TTL.
// - RevocationList: tokens revogados (logout, rotação de refresh_token).
// - LoginRateLimiter: trava temporária após várias senhas erradas seguidas
//   (mitigação de força bruta — ver W3Schools Cyber Security > Passwords).
// - OAuthAuthorizationServer: os "endpoints" /authorize e /token (RFC 6749).
// - OAuthFacade (instância única `OAuth`): fachada de alto nível usada por
//   js/api.js (AuthService.login/signup) e js/dashboard.js.
// ===============================

// ---------- OAuthCrypto: primitivas (base64url, SHA-256, HMAC, PKCE) ----------

class OAuthCrypto {
  // ---- base64url (RFC 4648 §5) — igual a base64 comum, mas sem "+", "/"
  // nem "=" de padding (é o formato exigido pelos segmentos de um JWT). ----

  static _bytesToBinaryString(bytes) {
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return binary;
  }

  static base64UrlEncodeBytes(bytes) {
    const b64 = btoa(OAuthCrypto._bytesToBinaryString(bytes));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  static base64UrlEncodeString(str) {
    return OAuthCrypto.base64UrlEncodeBytes(new TextEncoder().encode(str));
  }

  static base64UrlDecodeToBytes(b64url) {
    let b64 = String(b64url || "").replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // Decodifica bytes UTF-8 de volta para string JS "na mão" (sem depender
  // de TextDecoder, que nem sempre está disponível no ambiente de testes
  // deste projeto — ver tests/*.test.js, que só injetam TextEncoder/btoa/
  // atob/crypto no sandbox do vm). Cobre 1 a 4 bytes por caractere (todo o
  // intervalo Unicode válido em UTF-8, incluindo acentos e emojis).
  static _utf8BytesToString(bytes) {
    let result = "";
    let i = 0;
    while (i < bytes.length) {
      const b0 = bytes[i++];
      if (b0 < 0x80) {
        result += String.fromCharCode(b0);
      } else if (b0 >= 0xc0 && b0 < 0xe0 && i < bytes.length) {
        const b1 = bytes[i++];
        result += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
      } else if (b0 >= 0xe0 && b0 < 0xf0 && i + 1 < bytes.length) {
        const b1 = bytes[i++];
        const b2 = bytes[i++];
        result += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
      } else if (i + 2 < bytes.length) {
        const b1 = bytes[i++];
        const b2 = bytes[i++];
        const b3 = bytes[i++];
        let cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
        cp -= 0x10000;
        result += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      } else {
        i = bytes.length; // sequência incompleta no fim — encerra sem travar
      }
    }
    return result;
  }

  static base64UrlDecodeToString(b64url) {
    return OAuthCrypto._utf8BytesToString(OAuthCrypto.base64UrlDecodeToBytes(b64url));
  }

  // ---- aleatoriedade / hashing / HMAC (Web Crypto — SubtleCrypto) ----

  static randomBytes(len) {
    return crypto.getRandomValues(new Uint8Array(len));
  }

  // String aleatória própria para state/nonce/jti/authorization code —
  // usa o mesmo alfabeto do base64url (URL-safe, sem caracteres especiais).
  static randomString(byteLen = 24) {
    return OAuthCrypto.base64UrlEncodeBytes(OAuthCrypto.randomBytes(byteLen));
  }

  static async sha256(strAscii) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(strAscii));
    return new Uint8Array(digest);
  }

  static async _importHmacKey(rawKeyBytes, usage) {
    return crypto.subtle.importKey("raw", rawKeyBytes, { name: "HMAC", hash: "SHA-256" }, false, [usage]);
  }

  static async hmacSign(rawKeyBytes, messageBytes) {
    const key = await OAuthCrypto._importHmacKey(rawKeyBytes, "sign");
    const sig = await crypto.subtle.sign("HMAC", key, messageBytes);
    return new Uint8Array(sig);
  }

  static async hmacVerify(rawKeyBytes, messageBytes, signatureBytes) {
    const key = await OAuthCrypto._importHmacKey(rawKeyBytes, "verify");
    return crypto.subtle.verify("HMAC", key, signatureBytes, messageBytes);
  }

  // ---- PKCE (RFC 7636) — liga o authorization code a quem de fato o
  // solicitou, impedindo que um code interceptado seja trocado por tokens
  // por outra parte (mesmo sem "client secret", já que este é um cliente
  // 100% público/client-side). ----

  // 32 bytes aleatórios em base64url ⇒ ~43 caracteres, dentro da faixa
  // exigida pela RFC (43 a 128) e só com o alfabeto "unreserved" permitido.
  static generateCodeVerifier() {
    return OAuthCrypto.randomString(32);
  }

  static async codeChallengeFromVerifier(codeVerifier) {
    return OAuthCrypto.base64UrlEncodeBytes(await OAuthCrypto.sha256(codeVerifier));
  }
}

// ---------- JwtService: JSON Web Token (HS256) — assina/verifica/decodifica ----------

class JwtService {
  constructor(secretStore) {
    this.secretStore = secretStore;
  }

  async _key() {
    return this.secretStore.getSecretBytes();
  }

  // payload deve conter os claims de negócio (sub, tenant_id, name, role,
  // email, scope, ...); iat/exp/jti/token_type são preenchidos aqui.
  async sign(payload, { expiresInSeconds, tokenType }) {
    const header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
      ...payload,
      iat: now,
      exp: now + expiresInSeconds,
      jti: OAuthCrypto.randomString(12),
      token_type: tokenType,
    };
    const encHeader = OAuthCrypto.base64UrlEncodeString(JSON.stringify(header));
    const encPayload = OAuthCrypto.base64UrlEncodeString(JSON.stringify(fullPayload));
    const signingInput = `${encHeader}.${encPayload}`;
    const sigBytes = await OAuthCrypto.hmacSign(await this._key(), new TextEncoder().encode(signingInput));
    return `${signingInput}.${OAuthCrypto.base64UrlEncodeBytes(sigBytes)}`;
  }

  // Lê as claims sem checar assinatura/expiração — só deve ser usado logo
  // depois que O PRÓPRIO JwtService acabou de assinar o token (ex.: cache
  // síncrono de sessão em SessionManager.getSession(), js/api.js) ou para
  // decidir o que revogar (jti/exp) a partir de um token que vamos apagar
  // de qualquer forma. Nunca usar decodeUnsafe() para autorizar uma ação.
  decodeUnsafe(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) throw new Error("Token OAuth mal formado");
    return JSON.parse(OAuthCrypto.base64UrlDecodeToString(parts[1]));
  }

  // Verificação criptográfica de verdade: recalcula a assinatura HMAC e
  // compara (crypto.subtle.verify — comparação em tempo constante, não
  // "==="), e confere a expiração (claim "exp"). É isto que dá segurança de
  // fato ao token, ao contrário de decodeUnsafe().
  async verify(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) throw new Error("Token OAuth mal formado");
    const [encHeader, encPayload, encSig] = parts;
    const sigBytes = OAuthCrypto.base64UrlDecodeToBytes(encSig);
    const valid = await OAuthCrypto.hmacVerify(
      await this._key(),
      new TextEncoder().encode(`${encHeader}.${encPayload}`),
      sigBytes
    );
    if (!valid) throw new Error("Assinatura do token OAuth inválida");

    const payload = JSON.parse(OAuthCrypto.base64UrlDecodeToString(encPayload));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && now >= payload.exp) throw new Error("Token OAuth expirado");
    return payload;
  }
}

// ---------- OAuthSecretStore: chave HMAC persistida por instalação ----------
//
// Sem backend, não existe onde guardar um "client secret" fora do alcance
// do navegador — a chave abaixo é gerada uma única vez (256 bits, Web
// Crypto) na primeira execução deste app neste navegador e reaproveitada
// depois via localStorage, em vez de um segredo fixo no código-fonte
// (que qualquer um lendo o repositório poderia usar para forjar tokens).

class OAuthSecretStore {
  constructor(storageKey) {
    this.storageKey = storageKey;
    this._cachedBytes = null;
  }

  getSecretBytes() {
    if (this._cachedBytes) return this._cachedBytes;

    let b64 = null;
    try {
      b64 = localStorage.getItem(this.storageKey);
    } catch (e) {
      // localStorage indisponível (modo privado muito restrito etc.) —
      // segue com uma chave só desta execução (sessão perde ao recarregar).
    }

    if (!b64) {
      b64 = OAuthCrypto.base64UrlEncodeBytes(OAuthCrypto.randomBytes(32));
      try {
        localStorage.setItem(this.storageKey, b64);
      } catch (e) {
        // idem acima — não crítico, só reduz a durabilidade da chave.
      }
    }

    this._cachedBytes = OAuthCrypto.base64UrlDecodeToBytes(b64);
    return this._cachedBytes;
  }
}

// ---------- AuthorizationCodeStore: authorization codes de uso único ----------

class AuthorizationCodeStore {
  constructor(ttlMs = 60000) {
    this.ttlMs = ttlMs;
    this._codes = new Map();
  }

  put(identity, params) {
    const code = OAuthCrypto.randomString(24);
    this._codes.set(code, { identity, params, expiresAt: Date.now() + this.ttlMs, used: false });
    return code;
  }

  // Consome (e invalida) um code — nunca pode ser trocado por tokens duas vezes.
  consume(code) {
    const entry = this._codes.get(code);
    if (!entry) throw new Error("invalid_grant: authorization code desconhecido");
    this._codes.delete(code);
    if (entry.used) throw new Error("invalid_grant: authorization code já utilizado");
    if (Date.now() > entry.expiresAt) throw new Error("invalid_grant: authorization code expirado");
    return entry;
  }
}

// ---------- RevocationList: jti revogados (logout / rotação de refresh_token) ----------

class RevocationList {
  constructor(storageKey) {
    this.storageKey = storageKey;
  }

  _read() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) || "{}");
    } catch (e) {
      return {};
    }
  }

  _write(map) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(map));
    } catch (e) {
      // não crítico
    }
  }

  revoke(jti, exp) {
    if (!jti) return;
    const map = this._read();
    map[jti] = exp || Math.floor(Date.now() / 1000) + 3600;
    this._gc(map);
    this._write(map);
  }

  isRevoked(jti) {
    return Object.prototype.hasOwnProperty.call(this._read(), jti);
  }

  // Remove entradas cujo token original já expiraria de qualquer forma —
  // evita que a lista cresça sem limite ao longo do tempo.
  _gc(map) {
    const now = Math.floor(Date.now() / 1000);
    Object.keys(map).forEach((jti) => {
      if (map[jti] && map[jti] < now) delete map[jti];
    });
  }
}

// ---------- LoginRateLimiter: mitigação de força bruta no login ----------
//
// Boa prática de "CS Passwords" (W3Schools Cyber Security): travar
// temporariamente após várias senhas erradas seguidas para o mesmo e-mail,
// em vez de permitir tentativas ilimitadas. Guardado em localStorage
// (mesma limitação de sempre: escopo é este navegador, não um limite
// global do sistema, já que não há servidor).

class LoginRateLimiter {
  constructor(storageKey, { maxAttempts = 5, lockoutMs = 60000 } = {}) {
    this.storageKey = storageKey;
    this.maxAttempts = maxAttempts;
    this.lockoutMs = lockoutMs;
  }

  _read() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) || "{}");
    } catch (e) {
      return {};
    }
  }

  _write(map) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(map));
    } catch (e) {
      // não crítico
    }
  }

  _key(identifier) {
    return String(identifier || "").trim().toLowerCase();
  }

  check(identifier) {
    const entry = this._read()[this._key(identifier)];
    if (entry && entry.lockedUntil && Date.now() < entry.lockedUntil) {
      return { locked: true, retryAfterMs: entry.lockedUntil - Date.now() };
    }
    return { locked: false, retryAfterMs: 0 };
  }

  recordFailure(identifier) {
    const map = this._read();
    const key = this._key(identifier);
    const entry = map[key] || { count: 0 };
    entry.count += 1;
    if (entry.count >= this.maxAttempts) {
      entry.lockedUntil = Date.now() + this.lockoutMs;
      entry.count = 0;
    }
    map[key] = entry;
    this._write(map);
  }

  reset(identifier) {
    const map = this._read();
    delete map[this._key(identifier)];
    this._write(map);
  }
}

// ---------- Registro do "client" OAuth único deste app ----------
// (não há vários apps/terceiros; é o próprio painel se autenticando)

const OAUTH_CLIENT = {
  client_id: "fintech-spacecworp-dashboard",
  redirect_uri: "dashboard.html",
  allowed_scopes: ["profile", "expenses:read", "expenses:write", "reports:read", "payments:read", "team:manage"],
};

// ---------- OAuthAuthorizationServer: endpoints /authorize e /token (RFC 6749) ----------

class OAuthAuthorizationServer {
  constructor(jwtService, codeStore, revocationList, client) {
    this.jwt = jwtService;
    this.codes = codeStore;
    this.revocations = revocationList;
    this.client = client;
  }

  // Equivalente ao endpoint GET /authorize de um servidor OAuth real — só
  // deve ser chamado depois que a senha do usuário já foi conferida (ver
  // AuthService.login/signup em js/api.js): aqui apenas emite um
  // authorization code de uso único amarrado às claims da identidade já
  // autenticada + ao code_challenge (PKCE) informado.
  authorize({ client_id, redirect_uri, response_type, scope, code_challenge, code_challenge_method }, identity) {
    if (response_type !== "code") throw new Error("unsupported_response_type");
    if (client_id !== this.client.client_id) throw new Error("invalid_client");
    if (redirect_uri !== this.client.redirect_uri) throw new Error("invalid_request: redirect_uri não confere");
    if (!code_challenge || code_challenge_method !== "S256") {
      throw new Error("invalid_request: PKCE (code_challenge com S256) é obrigatório");
    }

    const grantedScope = (scope || []).filter((s) => this.client.allowed_scopes.includes(s));
    const code = this.codes.put(identity, { code_challenge, code_challenge_method, scope: grantedScope, client_id, redirect_uri });
    return { code };
  }

  // Equivalente ao endpoint POST /token — troca um authorization_code (+
  // code_verifier do PKCE) ou um refresh_token por um novo par de tokens.
  async token(params) {
    if (params.grant_type === "authorization_code") return this._exchangeCode(params);
    if (params.grant_type === "refresh_token") return this._refresh(params);
    throw new Error("unsupported_grant_type");
  }

  async _exchangeCode({ code, redirect_uri, client_id, code_verifier }) {
    const entry = this.codes.consume(code);
    if (entry.params.client_id !== client_id) throw new Error("invalid_grant: client_id não confere");
    if (entry.params.redirect_uri !== redirect_uri) throw new Error("invalid_grant: redirect_uri não confere");
    if (!code_verifier) throw new Error("invalid_grant: code_verifier ausente (PKCE)");

    const expectedChallenge = await OAuthCrypto.codeChallengeFromVerifier(code_verifier);
    if (expectedChallenge !== entry.params.code_challenge) {
      throw new Error("invalid_grant: code_verifier não confere com o code_challenge (PKCE)");
    }

    return this._issueTokenSet(entry.identity, entry.params.scope);
  }

  async _refresh({ refresh_token, client_id }) {
    if (client_id !== this.client.client_id) throw new Error("invalid_client");
    const claims = await this.jwt.verify(refresh_token);
    if (claims.token_type !== "refresh") throw new Error("invalid_grant: token informado não é um refresh_token");
    if (this.revocations.isRevoked(claims.jti)) throw new Error("invalid_grant: refresh_token revogado");

    // Rotação: revoga o refresh_token usado assim que um novo é emitido —
    // reduz a janela de uso caso um refresh_token antigo vaze/seja roubado.
    this.revocations.revoke(claims.jti, claims.exp);

    const identity = {
      user_id: claims.sub,
      tenant_id: claims.tenant_id,
      name: claims.name,
      role: claims.role,
      email: claims.email,
    };
    return this._issueTokenSet(identity, claims.scope || []);
  }

  async _issueTokenSet(identity, scope) {
    const basePayload = {
      iss: "fintech-spacecworp-oauth",
      aud: this.client.client_id,
      sub: identity.user_id,
      tenant_id: identity.tenant_id,
      name: identity.name,
      role: identity.role,
      email: identity.email,
      scope,
    };
    const access_token = await this.jwt.sign(basePayload, { expiresInSeconds: 60 * 60, tokenType: "access" }); // 1h
    const refresh_token = await this.jwt.sign(basePayload, { expiresInSeconds: 60 * 60 * 24 * 30, tokenType: "refresh" }); // 30d
    return { access_token, refresh_token, token_type: "Bearer", expires_in: 3600, scope };
  }

  revokeToken(token) {
    try {
      const claims = this.jwt.decodeUnsafe(token);
      this.revocations.revoke(claims.jti, claims.exp);
    } catch (e) {
      // token já inválido/mal formado — nada a revogar
    }
  }
}

// ---------- OAuthFacade: API de alto nível usada por js/api.js e js/dashboard.js ----------

class OAuthFacade {
  constructor() {
    this.crypto = OAuthCrypto;
    this.client = OAUTH_CLIENT;
    this.secretStore = new OAuthSecretStore("fintech_oauth_secret_v1");
    this.jwt = new JwtService(this.secretStore);
    this.codes = new AuthorizationCodeStore();
    this.revocations = new RevocationList("fintech_oauth_revoked_v1");
    this.server = new OAuthAuthorizationServer(this.jwt, this.codes, this.revocations, this.client);
    this.loginRateLimiter = new LoginRateLimiter("fintech_oauth_login_attempts_v1");
  }

  // Fluxo completo (Authorization Code + PKCE) para uma identidade já
  // autenticada por e-mail/senha em AuthService (js/api.js): gera
  // code_verifier/code_challenge, chama authorize() e troca o code por
  // tokens — exatamente as duas trocas de um cliente OAuth "de verdade"
  // (aqui, sem backend, acontecem no mesmo processo, mas seguindo o mesmo
  // contrato do protocolo).
  async issueSessionTokens(identity) {
    const codeVerifier = OAuthCrypto.generateCodeVerifier();
    const codeChallenge = await OAuthCrypto.codeChallengeFromVerifier(codeVerifier);

    const scope = this.client.allowed_scopes.filter((s) => identity.role === "admin" || s !== "team:manage");

    const { code } = this.server.authorize(
      {
        client_id: this.client.client_id,
        redirect_uri: this.client.redirect_uri,
        response_type: "code",
        scope,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      },
      identity
    );

    return this.server.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.client.redirect_uri,
      client_id: this.client.client_id,
      code_verifier: codeVerifier,
    });
  }

  refreshSessionTokens(refresh_token) {
    return this.server.token({ grant_type: "refresh_token", refresh_token, client_id: this.client.client_id });
  }

  verifyAccessToken(access_token) {
    return this.jwt.verify(access_token);
  }

  decodeUnsafe(token) {
    return this.jwt.decodeUnsafe(token);
  }

  revoke(token) {
    this.server.revokeToken(token);
  }
}

const OAuth = new OAuthFacade();
