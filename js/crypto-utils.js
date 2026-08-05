// ===============================
// frontend/js/crypto-utils.js
// Hash de senha 100% client-side usando Web Crypto (PBKDF2 + SHA-256).
// Não existe mais servidor: isto é apenas higiene básica, não uma
// fronteira de segurança real (quem tem acesso ao navegador vê tudo).
//
// Reescrito em POO: PasswordHasher concentra a lógica de derivação/
// comparação; hashPassword/verifyPassword continuam existindo como
// funções globais (mesma interface usada por js/api.js) delegando para
// a classe.
// ===============================

class PasswordHasher {
  constructor(iterations = 100000) {
    this.iterations = iterations;
  }

  static _bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary);
  }

  static _base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async _deriveBits(password, salt) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    const derived = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: this.iterations, hash: "SHA-256" },
      keyMaterial,
      256
    );
    return new Uint8Array(derived);
  }

  async hash(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const derived = await this._deriveBits(password, salt);
    return `${PasswordHasher._bytesToBase64(salt)}$${PasswordHasher._bytesToBase64(derived)}`;
  }

  async verify(password, storedHash) {
    try {
      const [saltB64, hashB64] = storedHash.split("$");
      const salt = PasswordHasher._base64ToBytes(saltB64);
      const expected = PasswordHasher._base64ToBytes(hashB64);
      const derived = await this._deriveBits(password, salt);
      if (derived.length !== expected.length) return false;
      let diff = 0;
      for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
      return diff === 0;
    } catch (e) {
      return false;
    }
  }
}

const PBKDF2_ITERATIONS = 100000;
const passwordHasher = new PasswordHasher(PBKDF2_ITERATIONS);

// ---------- camada de compatibilidade (mesma interface de antes) ----------

async function hashPassword(password) {
  return passwordHasher.hash(password);
}

async function verifyPassword(password, storedHash) {
  return passwordHasher.verify(password, storedHash);
}
