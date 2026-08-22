// ===============================
// frontend/js/api.js
// Camada de "API" 100% client-side (sem servidor, sem Python).
// Mantém a mesma interface que o antigo client REST usava, mas toda
// a lógica de negócio (antes em FastAPI) roda aqui, no navegador,
// persistindo em localStorage/Firestore via db.js.
//
// AVISO: como não há servidor, o isolamento entre "contas" (tenants)
// é apenas lógico/organizacional dentro do mesmo navegador — não é uma
// fronteira de segurança real. Qualquer pessoa com acesso ao navegador
// pode inspecionar o localStorage.
//
// Reescrito em POO: cada área de negócio (autenticação, planos, equipe,
// categorias, despesas, orçamento, relatórios, layouts de leitura,
// pagamentos) vira uma classe de serviço própria, e ApiFacade as compõe
// e expõe com a MESMA interface pública de antes (Api.signup(...),
// Api.addExpense(...) etc.) — nada muda para quem consome js/api.js
// (js/dashboard.js, js/auth-page.js, tests/*.test.js).
// ===============================

const SESSION_KEY = "fintech_saas_session_v1";
const SESSION_MASK_KEY = "fintech_saas_session_mask_v1";

function secureRandomString(size = 16) {
  const cryptoApi =
    (typeof globalThis !== "undefined" && globalThis.crypto)
    || (typeof window !== "undefined" && window.crypto)
    || null;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    return `fallback_${Date.now().toString(36)}`;
  }
  const bytes = new Uint8Array(size);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// SessionManager guarda, sob SESSION_KEY, o PAR DE TOKENS OAuth emitido por
// OAuth.issueSessionTokens (js/oauth.js) — não mais um JSON "cru" com o
// papel do usuário: { access_token, refresh_token, token_type, expires_in,
// scope }, ambos JWT (HS256) assinados. "token" (no sentido usado por
// Api.login/signup/Auth.setToken, e nos testes) é esse par serializado em
// uma única string JSON.
class SessionManager {
  constructor() {
    this._claimsCache = null; // cache em memória das claims já decodificadas (evita re-decodificar a cada chamada síncrona)
  }

  _getMaskKey() {
    let key = localStorage.getItem(SESSION_MASK_KEY);
    if (!key) {
      key = `${secureRandomString(16)}_${Date.now().toString(36)}`;
      localStorage.setItem(SESSION_MASK_KEY, key);
    }
    return key;
  }

  _encodeToken(rawToken) {
    const plain = String(rawToken || "");
    if (!plain) return plain;
    const key = this._getMaskKey();
    let masked = "";
    for (let i = 0; i < plain.length; i++) {
      masked += String.fromCharCode(plain.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return `enc:${btoa(masked)}`;
  }

  _decodeToken(storedValue) {
    const value = String(storedValue || "");
    if (!value.startsWith("enc:")) return value;
    const key = this._getMaskKey();
    let masked = "";
    try {
      masked = atob(value.slice(4));
    } catch (_err) {
      return null;
    }
    let plain = "";
    for (let i = 0; i < masked.length; i++) {
      plain += String.fromCharCode(masked.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return plain;
  }

  getToken() {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return stored;
    return this._decodeToken(stored);
  }

  setToken(token) {
    localStorage.setItem(SESSION_KEY, this._encodeToken(token));
    this._claimsCache = null;
  }

  // Revoga (best-effort) os tokens OAuth atuais antes de apagá-los — mesmo
  // não havendo um servidor central que os "invalide" globalmente, isso
  // marca os jti como revogados nesta instalação (ver RevocationList em
  // js/oauth.js), então um refresh_token vazado antes do logout não pode
  // mais ser trocado por um access_token novo a partir deste navegador.
  clearToken() {
    const raw = this.getToken();
    if (raw && typeof OAuth !== "undefined") {
      try {
        const tokens = JSON.parse(raw);
        if (tokens.refresh_token) OAuth.revoke(tokens.refresh_token);
        if (tokens.access_token) OAuth.revoke(tokens.access_token);
      } catch (e) {
        // token já corrompido/ilegível — nada a revogar, segue com a limpeza
      }
    }
    localStorage.removeItem(SESSION_KEY);
    this._claimsCache = null;
  }

  isLoggedIn() {
    return !!this.getToken();
  }

  // Leitura SÍNCRONA da sessão — usada por Auth.requireSession()/
  // requireAdmin() em praticamente todo método de ApiFacade. Decodifica
  // (sem reverificar assinatura/expiração a cada chamada, por custo — isso
  // é assíncrono, ver verifySession() abaixo) as claims do access_token já
  // emitido por OAuth nesta sessão do navegador.
  getSession() {
    if (this._claimsCache) return this._claimsCache;
    const raw = this.getToken();
    if (!raw) return null;
    try {
      const tokens = JSON.parse(raw);
      // Caminho normal: tokens.access_token é um JWT emitido por OAuth
      // (js/oauth.js). Caminho de degradação (tokens.legacy, ver
      // AuthService._issueOAuthTokens): usa os campos já decodificados,
      // sem exigir js/oauth.js.
      const claims = tokens.legacy
        ? { sub: tokens.user_id, tenant_id: tokens.tenant_id, name: tokens.name, role: tokens.role, email: tokens.email, scope: [] }
        : OAuth.decodeUnsafe(tokens.access_token);
      this._claimsCache = {
        user_id: claims.sub,
        tenant_id: claims.tenant_id,
        name: claims.name,
        role: claims.role,
        email: claims.email,
        scope: claims.scope || [],
      };
      return this._claimsCache;
    } catch (e) {
      return null;
    }
  }

  requireSession() {
    const session = this.getSession();
    if (!session) {
      const err = new Error("Não autenticado");
      err.status = 401;
      throw err;
    }
    return session;
  }

  requireAdmin() {
    const session = this.requireSession();
    if (session.role !== "admin") {
      const err = new Error("Apenas administradores podem executar esta ação");
      err.status = 403;
      throw err;
    }
    return session;
  }

  requireScope(scopeName) {
    const session = this.requireSession();
    const scopes = Array.isArray(session.scope) ? session.scope : [];
    if (!scopes.includes(scopeName)) {
      const err = new Error(`Escopo OAuth obrigatório: ${scopeName}`);
      err.status = 403;
      throw err;
    }
    return session;
  }

  // Verificação criptográfica de verdade (assinatura HMAC + expiração) do
  // access_token atual — e renovação automática via refresh_token (RFC 6749
  // §6, "Refreshing an Access Token") quando o access_token expirou mas o
  // refresh_token ainda é válido. Chamada uma vez ao entrar no painel (ver
  // DashboardController.init em js/dashboard.js); se falhar dos dois jeitos,
  // a sessão é encerrada. requireSession()/requireAdmin() continuam
  // síncronos e não chamam isto a cada ação — é a verificação "de entrada".
  async verifySession() {
    if (typeof OAuth === "undefined") return this.isLoggedIn(); // ambiente sem js/oauth.js carregado (não deveria acontecer)
    const raw = this.getToken();
    if (!raw) return false;

    let tokens;
    try {
      tokens = JSON.parse(raw);
    } catch (e) {
      this.clearToken();
      return false;
    }

    try {
      await OAuth.verifyAccessToken(tokens.access_token);
      return true;
    } catch (e) {
      // access_token expirado/inválido — tenta renovar com o refresh_token.
    }

    try {
      const fresh = await OAuth.refreshSessionTokens(tokens.refresh_token);
      this.setToken(JSON.stringify(fresh));
      return true;
    } catch (e) {
      this.clearToken();
      return false;
    }
  }
}

const Auth = new SessionManager();

// ---------- COMPANY_PROFILE: dados institucionais do operador da plataforma ----------
// Dados oficiais da empresa que opera este app (não é dado por tenant/
// usuário — é sempre o mesmo, exibido na tela "Configurações"), extraídos
// dos documentos legais da empresa (CNPJ, CMC/Alvará de Funcionamento da
// Prefeitura de Osasco/SP e Declaração de Atividade), como pede a
// legislação municipal (LC 404/2022, art. 92: manter o cadastro/Alvará
// disponível para consulta/fiscalização).
const COMPANY_PROFILE = {
  razao_social: "FELIPE RODRIGUES DOS SANTOS DESENVOLVIMENTO DE SOFTWARE LTDA",
  nome_fantasia: "SPACECWORP",
  produto: "Fintech Spacecworp",
  cnpj: "62.904.267/0001-60",
  porte: "ME (Microempresa)",
  inscricao_municipal_ccm: "0000251624",
  inscricao_estadual_jucesp: "35268056161",
  cnae_principal: "6201-5/01 — Desenvolvimento de programas de computador sob encomenda",
  atividades: [
    "Desenvolvimento de programas de computador sob encomenda",
    "Web design",
    "Desenvolvimento e licenciamento de programas de computador customizáveis",
    "Consultoria em tecnologia da informação",
    "Suporte técnico, manutenção e outros serviços em tecnologia da informação",
    "Tratamento de dados, provedores de serviços de aplicação e serviços de hospedagem na internet",
    "Portais, provedores de conteúdo e outros serviços de informação na internet",
  ],
  endereco: {
    logradouro: "Rua Zina, 118",
    bairro: "Jardim das Flores",
    cidade: "Osasco",
    uf: "SP",
    cep: "06112-090",
  },
  telefone: "(11) 99171-9629",
  inicio_atividade: "25/09/2025",
  alvara: {
    numero_processo: "202502026736",
    emitido_em: "08/10/2025",
    valido_ate: "31/03/2026",
    orgao: "Prefeitura do Município de Osasco — Secretaria de Tecnologia, Inovação e Desenvolvimento Econômico",
  },
  chave_pix: "62904267000160",
  contato_privacidade: "felipersantos1988@gmail.com",
};

// ---------- TenantRepository: leitura/serialização de tenants ----------

class TenantRepository {
  static find(db, tenantId) {
    return db.tenants.find((t) => t.id === tenantId) || null;
  }

  static planDetails(tenant) {
    return getPlan(tenant.plan);
  }

  static serialize(tenant) {
    return {
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      plan_details: TenantRepository.planDetails(tenant),
    };
  }
}

function normalizeGroupText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function areCategoriesSimilar(a, b) {
  const left = normalizeGroupText(a);
  const right = normalizeGroupText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return false;

  let common = 0;
  leftTokens.forEach((t) => {
    if (rightTokens.has(t)) common += 1;
  });
  const overlap = common / Math.max(leftTokens.size, rightTokens.size);
  return overlap >= 0.5;
}

function ensureBudgetGroupsForTenant(db, tenantId) {
  if (!Array.isArray(db.budgetGroups)) db.budgetGroups = [];
  const categoriesById = new Map(
    db.categories.filter((c) => c.tenant_id === tenantId).map((c) => [c.id, c])
  );
  const budgetCategoryIds = new Set(
    db.categoryBudgets.filter((b) => b.tenant_id === tenantId).map((b) => b.category_id).filter(Boolean)
  );
  const expenseCategoryIds = new Set(
    db.expenses
      .filter((e) => e.tenant_id === tenantId)
      .map((e) => e.category_id)
      .filter(Boolean)
  );
  const existing = new Set(
    db.budgetGroups
      .filter((g) => g.tenant_id === tenantId)
      .map((g) => `${g.budget_category_id}::${g.expense_category_id}`)
  );

  budgetCategoryIds.forEach((budgetCategoryId) => {
    const budgetCategory = categoriesById.get(budgetCategoryId);
    if (!budgetCategory) return;
    expenseCategoryIds.forEach((expenseCategoryId) => {
      const expenseCategory = categoriesById.get(expenseCategoryId);
      if (!expenseCategory) return;
      if (!areCategoriesSimilar(budgetCategory.name, expenseCategory.name)) return;
      const key = `${budgetCategoryId}::${expenseCategoryId}`;
      if (existing.has(key)) return;
      db.budgetGroups.push({
        id: nextId(db, "budgetGroups"),
        tenant_id: tenantId,
        name: `${budgetCategory.name} ↔ ${expenseCategory.name}`,
        budget_category_id: budgetCategoryId,
        expense_category_id: expenseCategoryId,
        auto_created: true,
        created_at: nowIso(),
      });
      existing.add(key);
    });
  });
}

function normalizeExpenseRuleKeyword(value) {
  return normalizeGroupText(value);
}

function monthRegexOk(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || "").trim());
}

function previousMonth(month) {
  if (!monthRegexOk(month)) return null;
  const [yearRaw, monthRaw] = String(month).split("-");
  let year = Number(yearRaw);
  let m = Number(monthRaw);
  m -= 1;
  if (m <= 0) {
    m = 12;
    year -= 1;
  }
  return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

function safeAuditMetadata(payload) {
  if (!payload || typeof payload !== "object") return null;
  const out = {};
  Object.keys(payload).forEach((k) => {
    const v = payload[k];
    if (v === undefined) return;
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      out[k] = v;
    }
  });
  return Object.keys(out).length ? out : null;
}

function appendAuditEvent(db, { tenant_id, user_id, action, entity, message, metadata }) {
  if (!tenant_id || !action || !entity) return null;
  if (!Array.isArray(db.auditEvents)) db.auditEvents = [];
  const event = {
    id: nextId(db, "auditEvents"),
    tenant_id: String(tenant_id),
    user_id: user_id ? String(user_id) : null,
    action: String(action),
    entity: String(entity),
    message: String(message || "").trim() || null,
    metadata: safeAuditMetadata(metadata),
    created_at: nowIso(),
  };
  db.auditEvents.push(event);
  return event;
}

// ---------- AuthService: signup/login/me ----------

class AuthService {
  constructor() {
    // E-mails que sempre têm a conta (tenant) no plano Premium, sem
    // precisar pagar via Pix. Aplicado no cadastro e "auto-curado" a cada
    // login, caso o plano tenha sido alterado por algum outro motivo.
    this.premiumOverrideEmails = ["felipersantos1988@gmail.com"];
  }

  _isPremiumOverrideEmail(email) {
    return this.premiumOverrideEmails.includes(String(email || "").trim().toLowerCase());
  }

  async signup({ company_name, admin_name, email, password }) {
    const db = await loadDb();

    if (db.users.some((u) => u.email === email)) {
      throw new Error("E-mail já cadastrado");
    }

    const tenant = {
      id: nextId(db, "tenants"),
      name: company_name,
      plan: this._isPremiumOverrideEmail(email) ? "premium" : DEFAULT_PLAN,
      created_at: nowIso(),
    };
    db.tenants.push(tenant);

    const password_hash = await hashPassword(password);
    const user = {
      id: nextId(db, "users"),
      tenant_id: tenant.id,
      name: admin_name,
      email,
      password_hash,
      role: "admin",
      created_at: nowIso(),
    };
    db.users.push(user);

    seedDefaultCategories(db, tenant.id);
    appendAuditEvent(db, {
      tenant_id: tenant.id,
      user_id: user.id,
      action: "account.signup",
      entity: "tenant",
      message: "Conta criada",
      metadata: { tenant_name: tenant.name, user_email: user.email },
    });
    await saveDb(db);

    const tokens = await this._issueOAuthTokens({
      user_id: user.id,
      tenant_id: tenant.id,
      name: user.name,
      role: user.role,
      email: user.email,
    }, { oauth_consent: true });
    return { token: JSON.stringify(tokens) };
  }

  async login({ email, password, oauth_consent }) {
    // Mitigação de força bruta (RFC 6749 não trata disso — é uma prática de
    // segurança de aplicação, ver W3Schools Cyber Security > Passwords):
    // trava temporariamente o e-mail depois de várias senhas erradas
    // seguidas, ANTES de sequer consultar o banco. Ver LoginRateLimiter em
    // js/oauth.js.
    if (typeof OAuth !== "undefined") {
      const limiter = OAuth.loginRateLimiter.check(email);
      if (limiter.locked) {
        const seconds = Math.max(1, Math.ceil(limiter.retryAfterMs / 1000));
        const err = new Error(`Muitas tentativas de login para este e-mail. Tente novamente em ${seconds}s.`);
        err.status = 429;
        throw err;
      }
    }

    const db = await loadDb();
    const user = db.users.find((u) => u.email === email);

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      if (typeof OAuth !== "undefined") OAuth.loginRateLimiter.recordFailure(email);
      throw new Error("E-mail ou senha inválidos");
    }
    if (typeof OAuth !== "undefined") OAuth.loginRateLimiter.reset(email);

    // Auto-cura: garante que e-mails da lista de override sempre estejam
    // no plano Premium, mesmo que o tenant tenha sido criado antes dessa
    // regra existir (ou o plano tenha sido alterado por outro motivo).
    if (this._isPremiumOverrideEmail(user.email)) {
      const tenant = TenantRepository.find(db, user.tenant_id);
      if (tenant && tenant.plan !== "premium") {
        tenant.plan = "premium";
        await saveDb(db);
      }
    }

    const tokens = await this._issueOAuthTokens({
      user_id: user.id,
      tenant_id: user.tenant_id,
      name: user.name,
      role: user.role,
      email: user.email,
    }, { oauth_consent: oauth_consent !== false });
    return { token: JSON.stringify(tokens) };
  }

  // Emite o par access_token/refresh_token através do fluxo OAuth 2.0
  // próprio (Authorization Code + PKCE — ver js/oauth.js) para uma
  // identidade que ACABOU de ser autenticada por e-mail/senha aqui. Se
  // js/oauth.js não estiver carregado por algum motivo, cai para um
  // "token" simples (mesmo formato de antes desta versão) em vez de
  // quebrar login/signup — degradação graciosa, nunca bloqueia o usuário.
  async _issueOAuthTokens(identity, opts = {}) {
    if (typeof OAuth === "undefined") {
      return { access_token: null, refresh_token: null, ...identity, legacy: true, oauth_consent: !!opts.oauth_consent };
    }
    return OAuth.issueSessionTokens(identity, opts);
  }

  async me() {
    const session = Auth.requireSession();
    const db = await loadDb();
    const tenant = TenantRepository.find(db, session.tenant_id);
    if (!tenant) throw new Error("Conta não encontrada");

    // Busca o registro atual do usuário no banco em vez de confiar cegamente
    // no nome/role gravados no token de sessão no momento do login: o token
    // fica parado no localStorage até o próximo login, então qualquer edição
    // feita depois (neste dispositivo ou sincronizada de outro) não aparecia
    // aqui. Se o usuário não existir mais (removido da equipe, por exemplo),
    // cai de volta nos dados do token como último recurso.
    const user = db.users.find((u) => u.id === session.user_id);

    return {
      user: user
        ? { id: user.id, name: user.name, email: user.email, role: user.role, tax_document: user.tax_document || null }
        : { id: session.user_id, name: session.name, role: session.role },
      tenant: TenantRepository.serialize(tenant),
    };
  }
}

// ---------- PlanService: catálogo de planos + troca de plano ----------

class PlanService {
  async plans() {
    return PLANS;
  }

  async changePlan(plan) {
    const session = Auth.requireAdmin();
    if (!planExists(plan)) throw new Error("Plano inválido");

    const db = await loadDb();
    const tenant = TenantRepository.find(db, session.tenant_id);
    const previousPlan = tenant.plan;
    tenant.plan = plan;
    appendAuditEvent(db, {
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      action: "plan.changed",
      entity: "tenant_plan",
      message: `Plano alterado de ${previousPlan} para ${plan}`,
      metadata: { previous_plan: previousPlan, new_plan: plan },
    });
    await saveDb(db);
    return TenantRepository.serialize(tenant);
  }
}

// ---------- UserService: equipe do tenant ----------

class UserService {
  async listUsers() {
    const session = Auth.requireSession();
    const db = await loadDb();
    return db.users
      .filter((u) => u.tenant_id === session.tenant_id)
      .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, created_at: u.created_at }));
  }

  async inviteUser({ name, email, password, role }) {
    const session = Auth.requireAdmin();
    const db = await loadDb();
    const tenant = TenantRepository.find(db, session.tenant_id);

    const maxUsers = TenantRepository.planDetails(tenant).max_users;
    const currentUsers = db.users.filter((u) => u.tenant_id === session.tenant_id).length;
    if (currentUsers >= maxUsers) {
      const err = new Error(
        `Limite de usuários do plano '${tenant.plan}' atingido (${maxUsers}). Faça upgrade do plano.`
      );
      err.status = 402;
      throw err;
    }

    if (db.users.some((u) => u.email === email)) {
      throw new Error("E-mail já cadastrado");
    }

    const password_hash = await hashPassword(password);
    db.users.push({
      id: nextId(db, "users"),
      tenant_id: session.tenant_id,
      name,
      email,
      password_hash,
      role: role || "member",
      created_at: nowIso(),
    });
    appendAuditEvent(db, {
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      action: "team.user_invited",
      entity: "user",
      message: `Usuário convidado para a equipe (${email})`,
      metadata: { email, role: role || "member" },
    });
    await saveDb(db);
    return { ok: true };
  }
}

// ---------- CategoryService ----------

class CategoryService {
  async listCategories() {
    const session = Auth.requireSession();
    const db = await loadDb();
    return db.categories
      .filter((c) => c.tenant_id === session.tenant_id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ id: c.id, name: c.name }));
  }

  async addCategory(name) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const exists = db.categories.some((c) => c.tenant_id === session.tenant_id && c.name === name);
    if (!exists) {
      const category = { id: nextId(db, "categories"), tenant_id: session.tenant_id, name };
      db.categories.push(category);
      appendAuditEvent(db, {
        tenant_id: session.tenant_id,
        user_id: session.user_id,
        action: "category.created",
        entity: "category",
        message: `Categoria criada (${name})`,
        metadata: { category_id: category.id, category_name: name },
      });
      await saveDb(db);
    }
    return { ok: true };
  }
}

// ---------- ExpenseRuleService ----------

class ExpenseRuleService {
  async listExpenseRules() {
    const session = Auth.requireSession();
    const db = await loadDb();
    return (db.expenseRules || [])
      .filter((r) => r.tenant_id === session.tenant_id)
      .map((r) => {
        const category = db.categories.find((c) => c.id === r.category_id);
        return {
          id: r.id,
          category_id: r.category_id,
          category_name: category ? category.name : null,
          keyword: r.keyword,
          match_type: r.match_type || "contains",
          created_at: r.created_at || null,
        };
      })
      .sort((a, b) => (a.keyword || "").localeCompare(b.keyword || ""));
  }

  async addExpenseRule({ category_id, keyword, match_type }) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const safeKeyword = String(keyword || "").trim();
    const normalizedKeyword = normalizeExpenseRuleKeyword(safeKeyword);
    if (!category_id) throw new Error("Categoria é obrigatória.");
    if (!safeKeyword || !normalizedKeyword) throw new Error("Palavra-chave da regra é obrigatória.");
    const normalizedMatchType = String(match_type || "contains").toLowerCase() === "exact" ? "exact" : "contains";

    const exists = (db.expenseRules || []).some(
      (r) =>
        r.tenant_id === session.tenant_id &&
        r.category_id === category_id &&
        (r.match_type || "contains") === normalizedMatchType &&
        (r.keyword_normalized || normalizeExpenseRuleKeyword(r.keyword)) === normalizedKeyword
    );
    if (exists) throw new Error("Já existe uma regra igual para esta categoria.");

    if (!Array.isArray(db.expenseRules)) db.expenseRules = [];
    const record = {
      id: nextId(db, "expenseRules"),
      tenant_id: session.tenant_id,
      category_id,
      keyword: safeKeyword,
      keyword_normalized: normalizedKeyword,
      match_type: normalizedMatchType,
      created_at: nowIso(),
    };
    db.expenseRules.push(record);
    await saveDb(db);
    return record;
  }

  async deleteExpenseRule(id) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const before = (db.expenseRules || []).length;
    db.expenseRules = (db.expenseRules || []).filter((r) => !(r.id === id && r.tenant_id === session.tenant_id));
    await saveDb(db);
    if (db.expenseRules.length === before) throw new Error("Regra não encontrada.");
    return { ok: true };
  }
}

// ---------- ExpenseService ----------

class ExpenseService {
  _resolveCategoryByRule(db, tenantId, description) {
    const normalizedDescription = normalizeExpenseRuleKeyword(description);
    if (!normalizedDescription) return null;
    const rules = (db.expenseRules || []).filter((r) => r.tenant_id === tenantId);
    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i];
      const keyword = rule.keyword_normalized || normalizeExpenseRuleKeyword(rule.keyword);
      if (!keyword) continue;
      const matchType = rule.match_type || "contains";
      const matches = matchType === "exact"
        ? normalizedDescription === keyword
        : normalizedDescription.includes(keyword);
      if (matches) return rule.category_id || null;
    }
    return null;
  }

  async listExpenses(allUsers = false) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const scoped = db.expenses.filter((e) => e.tenant_id === session.tenant_id);
    const filtered =
      allUsers && session.role === "admin" ? scoped : scoped.filter((e) => e.user_id === session.user_id);

    return filtered
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((e) => {
        const category = db.categories.find((c) => c.id === e.category_id);
        return {
          id: e.id,
          amount: e.amount,
          date: e.date,
          created_at: e.created_at || null,
          description: e.description,
          transaction_number: e.transaction_number || null,
          category_id: e.category_id,
          category_name: category ? category.name : null,
          auto_categorized_by_rule: !!e.auto_categorized_by_rule,
          user_id: e.user_id,
          is_extra: !!e.is_extra,
          extra_charge: e.extra_charge || 0,
          // Despesas geradas pelo orcamento_agent/mp_expenses.py (via API,
          // fora do navegador) trazem esses campos -- despesas lançadas
          // manualmente pelo painel nunca têm generatedByMercadoPago (fica
          // undefined -> false aqui).
          generated_by_mercado_pago: !!e.generatedByMercadoPago,
          mercado_pago_payment_id: e.mercadoPagoPaymentId || null,
          // "api" (mp_expenses.py, via Access Token); null em despesas
          // geradas antes desse campo existir.
          generated_by_mercado_pago_source: e.mercadoPagoSource || null,
        };
      });
  }

  // Uso do limite diário de despesas do plano (para exibir "2/6 hoje" etc.)
  async getExpenseQuota() {
    const session = Auth.requireSession();
    const db = await loadDb();
    const tenant = TenantRepository.find(db, session.tenant_id);
    const planDetails = TenantRepository.planDetails(tenant);
    const today = nowIso().slice(0, 10);
    const usedToday = db.expenses.filter(
      (e) =>
        e.tenant_id === session.tenant_id &&
        e.user_id === session.user_id &&
        (e.created_at || "").slice(0, 10) === today
    ).length;
    return {
      plan: tenant.plan,
      used_today: usedToday,
      max_per_day: planDetails.max_expenses_day,
      overage_price: planDetails.overage_price || 0,
      unlimited: !isFinite(planDetails.max_expenses_day),
    };
  }

  async addExpense({ amount, date, description, category_id, transaction_number }) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const tenant = TenantRepository.find(db, session.tenant_id);
    const planDetails = TenantRepository.planDetails(tenant);

    // Limite é diário e por usuário (plano Free = 6 despesas/dia).
    const today = nowIso().slice(0, 10); // "YYYY-MM-DD"
    const maxPerDay = planDetails.max_expenses_day;
    const todayCount = db.expenses.filter(
      (e) =>
        e.tenant_id === session.tenant_id &&
        e.user_id === session.user_id &&
        (e.created_at || "").slice(0, 10) === today
    ).length;

    // No plano Free, ao atingir o limite diário a despesa é marcada como
    // "extra" (R$ 5,00/unidade). A camada de UI (dashboard.js) já exige o
    // pagamento real via Pix antes de chamar addExpense nesse caso — aqui
    // só fazemos a marcação/registro do valor cobrado.
    const isExtra = isFinite(maxPerDay) && todayCount >= maxPerDay;
    const extraCharge = isExtra ? planDetails.overage_price || 0 : 0;

    const finalCategoryId = category_id || this._resolveCategoryByRule(db, session.tenant_id, description);
    const expense = {
      id: nextId(db, "expenses"),
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      category_id: finalCategoryId || null,
      amount,
      date,
      description: description || "",
      transaction_number: transaction_number || null,
      auto_categorized_by_rule: !category_id && !!finalCategoryId,
      created_at: nowIso(),
      is_extra: isExtra,
      extra_charge: extraCharge,
    };
    db.expenses.push(expense);
    ensureBudgetGroupsForTenant(db, session.tenant_id);
    appendAuditEvent(db, {
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      action: "expense.created",
      entity: "expense",
      message: `Despesa registrada (${expense.description || "Sem descrição"})`,
      metadata: {
        expense_id: expense.id,
        amount: Number(expense.amount) || 0,
        date: expense.date,
        category_id: expense.category_id || null,
        is_extra: !!expense.is_extra,
      },
    });
    await saveDb(db);
    return { id: expense.id, is_extra: isExtra, extra_charge: extraCharge, plan: tenant.plan };
  }

  async deleteExpense(id) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const toDelete = db.expenses.find((e) => e.id === id && e.tenant_id === session.tenant_id);
    const before = db.expenses.length;
    db.expenses = db.expenses.filter((e) => !(e.id === id && e.tenant_id === session.tenant_id));
    if (db.expenses.length === before) throw new Error("Despesa não encontrada");
    appendAuditEvent(db, {
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      action: "expense.deleted",
      entity: "expense",
      message: `Despesa excluída (${id})`,
      metadata: {
        expense_id: id,
        amount: toDelete ? Number(toDelete.amount) || 0 : null,
        date: toDelete ? toDelete.date : null,
      },
    });
    await saveDb(db);
    return { ok: true };
  }

  async updateExpense(id, { amount, date, description, category_id, transaction_number }) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const expense = db.expenses.find((e) => e.id === id && e.tenant_id === session.tenant_id);
    if (!expense) throw new Error("Despesa não encontrada");

    expense.amount = amount;
    expense.date = date;
    expense.description = description || "";
    const finalCategoryId = category_id || this._resolveCategoryByRule(db, session.tenant_id, expense.description);
    expense.category_id = finalCategoryId || null;
    expense.auto_categorized_by_rule = !category_id && !!finalCategoryId;
    if (transaction_number !== undefined) expense.transaction_number = transaction_number || null;

    ensureBudgetGroupsForTenant(db, session.tenant_id);
    appendAuditEvent(db, {
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      action: "expense.updated",
      entity: "expense",
      message: `Despesa atualizada (${expense.id})`,
      metadata: {
        expense_id: expense.id,
        amount: Number(expense.amount) || 0,
        date: expense.date,
        category_id: expense.category_id || null,
      },
    });
    await saveDb(db);
    return { ok: true };
  }

  async applyRulesToUncategorized({ month } = {}) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const targetMonth = month && monthRegexOk(month) ? month : null;
    let updated = 0;
    (db.expenses || []).forEach((expense) => {
      if (expense.tenant_id !== session.tenant_id) return;
      if (targetMonth && String(expense.date || "").slice(0, 7) !== targetMonth) return;
      if (expense.category_id) return;
      const resolved = this._resolveCategoryByRule(db, session.tenant_id, expense.description || "");
      if (!resolved) return;
      expense.category_id = resolved;
      expense.auto_categorized_by_rule = true;
      updated += 1;
    });
    if (updated > 0) {
      ensureBudgetGroupsForTenant(db, session.tenant_id);
      await saveDb(db);
    }
    return { updated, month: targetMonth };
  }
}

// ---------- BudgetService: limite geral do mês (sem categoria) ----------

class BudgetService {
  async setBudget({ limit_value, month }) {
    const session = Auth.requireSession();
    const db = await loadDb();
    if (!month) throw new Error("Mês é obrigatório.");
    if (!isFinite(limit_value)) throw new Error("Limite é obrigatório.");
    let budget = db.budgets.find(
      (b) => b.tenant_id === session.tenant_id && b.user_id === session.user_id && b.month === month
    );
    if (budget) {
      budget.limit_value = limit_value;
    } else {
      db.budgets.push({
        id: nextId(db, "budgets"),
        tenant_id: session.tenant_id,
        user_id: session.user_id,
        limit_value,
        month,
      });
    }
    appendAuditEvent(db, {
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      action: "budget.monthly_set",
      entity: "budget",
      message: `Limite geral mensal definido para ${month}`,
      metadata: { month, limit_value: Number(limit_value) || 0 },
    });
    await saveDb(db);
    return { ok: true };
  }

  async listBudgets() {
    const session = Auth.requireSession();
    const db = await loadDb();
    return db.budgets
      .filter((b) => b.tenant_id === session.tenant_id && b.user_id === session.user_id)
      .slice()
      .sort((a, b) => (a.month < b.month ? 1 : -1));
  }

  async deleteBudget(id) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const removed = db.budgets.find(
      (b) => b.id === id && b.tenant_id === session.tenant_id && b.user_id === session.user_id
    );
    const before = db.budgets.length;
    db.budgets = db.budgets.filter(
      (b) => !(b.id === id && b.tenant_id === session.tenant_id && b.user_id === session.user_id)
    );
    if (db.budgets.length === before) throw new Error("Orçamento não encontrado");
    appendAuditEvent(db, {
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      action: "budget.monthly_deleted",
      entity: "budget",
      message: `Limite geral mensal removido (${id})`,
      metadata: { budget_id: id, month: removed ? removed.month : null },
    });
    await saveDb(db);
    return { ok: true };
  }

  async getAlerts(month) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const targetMonth = month || new Date().toISOString().slice(0, 7);

    const budget = db.budgets.find(
      (b) => b.tenant_id === session.tenant_id && b.user_id === session.user_id && b.month === targetMonth
    );
    const limitValue = budget ? budget.limit_value : 0;

    const total = db.expenses
      .filter(
        (e) =>
          e.tenant_id === session.tenant_id &&
          e.user_id === session.user_id &&
          e.date.slice(0, 7) === targetMonth
      )
      .reduce((sum, e) => sum + e.amount, 0);

    return { total, limit: limitValue, over_budget: !!(limitValue && total > limitValue) };
  }
}

// ---------- CategoryBudgetService: Previsto por categoria (fluxo
// "Orçamento & Despesas" -> Página 1 "Importar Orçamento") ----------
//
// Diferente de BudgetService acima (um limite geral por usuário/mês), isto
// é o Previsto POR CATEGORIA, compartilhado pela conta inteira (tenant) --
// é o orçamento importado de uma planilha (ver js/budget-ai.js) e
// "adotado" no app. O Realizado nunca é lido daqui: é sempre calculado
// na hora a partir das despesas reais (ver getBudgetOverview), para que
// registrar uma despesa na Página 2 do fluxo reflita automaticamente no
// comparativo da Página 3, sem precisar reimportar nada.

class CategoryBudgetService {
  async listCategoryBudgets(month) {
    const session = Auth.requireSession();
    const db = await loadDb();
    return db.categoryBudgets
      .filter((b) => b.tenant_id === session.tenant_id && (!month || b.month === month))
      .map((b) => {
        const category = b.category_id ? db.categories.find((c) => c.id === b.category_id) : null;
        const categoryName = b.category_name || (category ? category.name : null);
        return { id: b.id, category_id: b.category_id || null, category_name: categoryName, month: b.month, previsto: b.previsto };
      })
      .sort((a, b) => (a.month === b.month ? String(a.category_name || "").localeCompare(String(b.category_name || "")) : (a.month < b.month ? -1 : 1)));
  }

  async setCategoryBudget({ budget_id, category_id, category_name, month, previsto }) {
    const session = Auth.requireSession();
    if (!month) throw new Error("Mês é obrigatório.");
    if (!isFinite(previsto)) throw new Error("Previsto é obrigatório.");
    if (!budget_id && !category_id && !String(category_name || "").trim()) {
      throw new Error("Informe ao menos orçamento, categoria ou nome da categoria.");
    }
    const db = await loadDb();
    const normalizedName = normalizeGroupText(category_name);
    const category = category_id
      ? db.categories.find((c) => c.id === category_id && c.tenant_id === session.tenant_id)
      : null;
    const resolvedName = String(category_name || (category && category.name) || "").trim() || null;

    let record = budget_id
      ? db.categoryBudgets.find((b) => b.id === budget_id && b.tenant_id === session.tenant_id)
      : db.categoryBudgets.find(
        (b) => (
          b.tenant_id === session.tenant_id &&
          b.month === month &&
          (
            (category_id && b.category_id === category_id)
            || (!category_id && !b.category_id && normalizeGroupText(b.category_name) === normalizedName)
          )
        )
      );

    if (record) {
      record.previsto = previsto;
      if (category) {
        record.category_id = category.id;
        record.category_name = category.name;
        record.category_name_normalized = normalizeGroupText(category.name);
      } else if (resolvedName) {
        record.category_id = record.category_id || null;
        record.category_name = resolvedName;
        record.category_name_normalized = normalizeGroupText(resolvedName);
      }
    } else {
      record = {
        id: nextId(db, "categoryBudgets"),
        tenant_id: session.tenant_id,
        category_id: category ? category.id : null,
        category_name: resolvedName,
        category_name_normalized: normalizeGroupText(resolvedName),
        month,
        previsto,
        imported_from_budget: true,
      };
      db.categoryBudgets.push(record);
    }
    ensureBudgetGroupsForTenant(db, session.tenant_id);
    appendAuditEvent(db, {
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      action: "budget.category_set",
      entity: "category_budget",
      message: `Orçamento por categoria definido para ${month}`,
      metadata: {
        category_budget_id: record.id,
        month,
        category_id: record.category_id || null,
        category_name: record.category_name || null,
        previsto: Number(record.previsto) || 0,
      },
    });
    await saveDb(db);
    return record;
  }

  async deleteCategoryBudget(id) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const toDelete = db.categoryBudgets.find((b) => b.id === id && b.tenant_id === session.tenant_id);
    if (!toDelete) throw new Error("Orçamento por categoria não encontrado.");
    db.categoryBudgets = db.categoryBudgets.filter((b) => b.id !== id);
    db.budgetGroups = (db.budgetGroups || []).filter(
      (g) => !(g.tenant_id === session.tenant_id && g.budget_category_id === toDelete.category_id)
    );
    ensureBudgetGroupsForTenant(db, session.tenant_id);
    appendAuditEvent(db, {
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      action: "budget.category_deleted",
      entity: "category_budget",
      message: `Orçamento por categoria removido (${id})`,
      metadata: {
        category_budget_id: id,
        month: toDelete.month,
        category_id: toDelete.category_id || null,
        category_name: toDelete.category_name || null,
      },
    });
    await saveDb(db);
    return { ok: true };
  }

  // Uso do limite diário de importações de orçamento do plano (para exibir
  // "2/3 hoje", saber quando é extra e qual cobrança aplicar).
  async getBudgetImportQuota() {
    const session = Auth.requireSession();
    const db = await loadDb();
    const tenant = TenantRepository.find(db, session.tenant_id);
    const planDetails = TenantRepository.planDetails(tenant);
    const today = nowIso().slice(0, 10);
    const usedToday = (db.auditEvents || []).filter(
      (e) =>
        e.tenant_id === session.tenant_id
        && e.user_id === session.user_id
        && e.action === "budget.category_imported"
        && String(e.created_at || "").slice(0, 10) === today
    ).length;
    return {
      plan: tenant.plan,
      used_today: usedToday,
      max_per_day: planDetails.max_budget_imports_day,
      overage_price: planDetails.budget_import_overage_price || 0,
      unlimited: !isFinite(planDetails.max_budget_imports_day),
    };
  }

  // Fecha o fluxo Importar Orçamento -> Previsto por categoria: recebe as
  // linhas lidas de uma planilha (js/budget-ai.js: [{ categoria, previsto }])
  // e, para o mês informado, cria as categorias que ainda não existirem
  // (por nome, sem diferenciar maiúsculas/acentos exatos) e grava/atualiza
  // o Previsto de cada uma. Idempotente: rodar de novo com o mesmo arquivo
  // e mês só atualiza os valores, não duplica nada.
  async importCategoryBudgets({ month, rows }) {
    const session = Auth.requireSession();
    if (!month) throw new Error("Informe o mês (AAAA-MM) para aplicar este orçamento.");
    if (!Array.isArray(rows) || !rows.length) throw new Error("Nenhuma linha de orçamento para importar.");

    const db = await loadDb();
    const tenant = TenantRepository.find(db, session.tenant_id);
    const planDetails = TenantRepository.planDetails(tenant);
    const maxImportsPerDay = Number(planDetails.max_budget_imports_day);
    const today = nowIso().slice(0, 10);
    const usedToday = (db.auditEvents || []).filter(
      (e) =>
        e.tenant_id === session.tenant_id
        && e.user_id === session.user_id
        && e.action === "budget.category_imported"
        && String(e.created_at || "").slice(0, 10) === today
    ).length;
    const isExtra = isFinite(maxImportsPerDay) && usedToday >= maxImportsPerDay;
    const extraCharge = isExtra ? planDetails.budget_import_overage_price || 0 : 0;

    // Agrupa por nome de categoria (case-insensitive), somando o Previsto --
    // cobre o caso de a planilha ter mais de uma linha para a mesma
    // categoria (ex.: uma planilha "larga" com vários meses lidos juntos).
    const byName = new Map();
    rows.forEach((r) => {
      const name = String((r && r.categoria) || "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      const current = byName.get(key) || { name, previsto: 0 };
      current.previsto += Number(r.previsto) || 0;
      byName.set(key, current);
    });
    if (!byName.size) throw new Error("Nenhuma categoria válida encontrada para importar.");

    const applied = [];

    byName.forEach(({ name, previsto }) => {
      const category = db.categories.find(
        (c) => c.tenant_id === session.tenant_id && c.name.toLowerCase() === name.toLowerCase()
      );
      const normalizedName = normalizeGroupText(name);

      let budget = db.categoryBudgets.find(
        (b) =>
          b.tenant_id === session.tenant_id &&
          b.month === month &&
          (
            (category && b.category_id === category.id)
            || (!category && !b.category_id && normalizeGroupText(b.category_name) === normalizedName)
          )
      );
      if (budget) {
        budget.previsto = previsto;
        budget.category_name = name;
        budget.category_name_normalized = normalizedName;
        budget.category_id = category ? category.id : null;
        budget.imported_from_budget = true;
      } else {
        budget = {
          id: nextId(db, "categoryBudgets"),
          tenant_id: session.tenant_id,
          category_id: category ? category.id : null,
          category_name: name,
          category_name_normalized: normalizedName,
          month,
          previsto,
          imported_from_budget: true,
        };
        db.categoryBudgets.push(budget);
      }
      applied.push({ category_id: category ? category.id : null, category_name: name, previsto });
    });

    ensureBudgetGroupsForTenant(db, session.tenant_id);
    appendAuditEvent(db, {
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      action: "budget.category_imported",
      entity: "category_budget",
      message: `Importação de orçamento por categoria (${month})`,
      metadata: { month, categories_count: applied.length, is_extra: isExtra, extra_charge: extraCharge },
    });
    await saveDb(db);
    return { month, created_categories: 0, categories_count: applied.length, rows: applied, is_extra: isExtra, extra_charge: extraCharge };
  }

  // Visão completa do fluxo: Previsto (importado, por categoria) x
  // Realizado (soma das despesas reais da conta inteira naquele mês) --
  // é o que a Página 3 ("Alertas / Orçamento") do painel mostra. Categorias
  // sem Previsto definido, mas com despesas no mês, aparecem como
  // "SEM_ORCAMENTO" em vez de um falso "dentro do orçamento" (mesmo
  // cuidado do orcamento_agent/mp_sync.py para meses sem orçamento
  // cadastrado).
  async getBudgetOverview(month) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const targetMonth = month || nowIso().slice(0, 7);

    const budgets = db.categoryBudgets.filter((b) => b.tenant_id === session.tenant_id && b.month === targetMonth);
    const expenses = db.expenses.filter(
      (e) => e.tenant_id === session.tenant_id && (e.date || "").slice(0, 7) === targetMonth
    );

    const byCategory = new Map();
    const budgetNameKeyByNormalizedCategory = new Map();
    budgets.forEach((b) => {
      const category = b.category_id ? db.categories.find((c) => c.id === b.category_id) : null;
      const categoryName = b.category_name || (category ? category.name : null) || "Sem categoria";
      const key = b.category_id || `budget_name:${normalizeGroupText(categoryName)}`;
      byCategory.set(key, {
        category_id: b.category_id || null,
        category_name: categoryName,
        previsto: b.previsto,
        realizado: 0,
        hasBudget: true,
      });
      if (!b.category_id && categoryName) {
        budgetNameKeyByNormalizedCategory.set(normalizeGroupText(categoryName), key);
      }
    });
    expenses.forEach((e) => {
      const expenseCategory = e.category_id ? db.categories.find((c) => c.id === e.category_id) : null;
      const expenseCategoryName = expenseCategory ? expenseCategory.name : "Sem categoria";
      let key = e.category_id || "__sem_categoria__";
      if (!byCategory.has(key)) {
        const budgetNameKey = budgetNameKeyByNormalizedCategory.get(normalizeGroupText(expenseCategoryName));
        if (budgetNameKey) key = budgetNameKey;
      }
      if (!byCategory.has(key)) {
        byCategory.set(key, {
          category_id: e.category_id || null,
          category_name: expenseCategoryName,
          previsto: 0,
          realizado: 0,
          hasBudget: false,
        });
      }
      byCategory.get(key).realizado += e.amount;
    });

    const rows = Array.from(byCategory.values())
      .map((r) => {
        const category = r.category_id ? db.categories.find((c) => c.id === r.category_id) : null;
        const saldo = r.previsto - r.realizado;
        const status = !r.hasBudget ? "SEM_ORCAMENTO" : saldo < 0 ? "ESTOURADO" : "DENTRO_DO_ORCAMENTO";
        return {
          category_id: r.category_id,
          category_name: r.category_name || (category ? category.name : "Sem categoria"),
          previsto: r.previsto,
          realizado: r.realizado,
          saldo,
          status,
        };
      })
      .sort((a, b) => a.category_name.localeCompare(b.category_name));

    const totalPrevisto = rows.reduce((s, r) => s + r.previsto, 0);
    const totalRealizado = rows.reduce((s, r) => s + r.realizado, 0);
    const alerts = rows.filter((r) => r.status === "ESTOURADO");

    return {
      month: targetMonth,
      rows,
      totalPrevisto,
      totalRealizado,
      saldoTotal: totalPrevisto - totalRealizado,
      alerts,
      overBudget: alerts.length > 0,
      hasAnyBudget: budgets.length > 0,
    };
  }

  async copyCategoryBudgetsRecurring({ targetMonth, sourceMonth, adjustmentPercent }) {
    const session = Auth.requireSession();
    const db = await loadDb();
    if (!monthRegexOk(targetMonth)) throw new Error("Mês de destino inválido (use AAAA-MM).");
    const effectiveSourceMonth = monthRegexOk(sourceMonth) ? sourceMonth : previousMonth(targetMonth);
    if (!effectiveSourceMonth) throw new Error("Mês de origem inválido.");

    const factor = 1 + (Number(adjustmentPercent || 0) / 100);
    if (!isFinite(factor) || factor <= 0) throw new Error("Ajuste percentual inválido.");

    const sourceRows = (db.categoryBudgets || []).filter(
      (b) => b.tenant_id === session.tenant_id && b.month === effectiveSourceMonth
    );
    if (!sourceRows.length) throw new Error("Não há orçamento por categoria no mês de origem.");

    let created = 0;
    let updated = 0;
    sourceRows.forEach((row) => {
      const adjusted = Math.round((Number(row.previsto || 0) * factor) * 100) / 100;
      const existing = db.categoryBudgets.find(
        (b) =>
          b.tenant_id === session.tenant_id &&
          b.month === targetMonth &&
          (
            (row.category_id && b.category_id === row.category_id)
            || (!row.category_id && !b.category_id && normalizeGroupText(b.category_name) === normalizeGroupText(row.category_name))
          )
      );
      if (existing) {
        existing.previsto = adjusted;
        updated += 1;
      } else {
        db.categoryBudgets.push({
          id: nextId(db, "categoryBudgets"),
          tenant_id: session.tenant_id,
          category_id: row.category_id || null,
          category_name: row.category_name || null,
          category_name_normalized: normalizeGroupText(row.category_name),
          month: targetMonth,
          previsto: adjusted,
          imported_from_budget: !!row.imported_from_budget,
        });
        created += 1;
      }
    });

    ensureBudgetGroupsForTenant(db, session.tenant_id);
    appendAuditEvent(db, {
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      action: "budget.category_copied_recurring",
      entity: "category_budget",
      message: `Orçamento recorrente copiado para ${targetMonth}`,
      metadata: {
        target_month: targetMonth,
        source_month: effectiveSourceMonth,
        adjustment_percent: Number(adjustmentPercent || 0),
        copied_rows: sourceRows.length,
      },
    });
    await saveDb(db);
    return {
      target_month: targetMonth,
      source_month: effectiveSourceMonth,
      adjustment_percent: Number(adjustmentPercent || 0),
      copied_rows: sourceRows.length,
      created,
      updated,
    };
  }
}

// ---------- BudgetGroupService: relacionamento automático entre itens ----------

class BudgetGroupService {
  async listBudgetGroups() {
    const session = Auth.requireSession();
    const db = await loadDb();
    ensureBudgetGroupsForTenant(db, session.tenant_id);
    await saveDb(db);
    return (db.budgetGroups || [])
      .filter((g) => g.tenant_id === session.tenant_id)
      .map((g) => {
        const budgetCategory = db.categories.find((c) => c.id === g.budget_category_id);
        const expenseCategory = db.categories.find((c) => c.id === g.expense_category_id);
        return {
          id: g.id,
          name: g.name,
          budget_category_id: g.budget_category_id,
          budget_category_name: budgetCategory ? budgetCategory.name : null,
          expense_category_id: g.expense_category_id,
          expense_category_name: expenseCategory ? expenseCategory.name : null,
          auto_created: !!g.auto_created,
          created_at: g.created_at || null,
        };
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }
}

// ---------- AuditTrailService: trilha de auditoria financeira ----------

class AuditTrailService {
  async listAuditTrail({ limit = 100, allUsers = true } = {}) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const max = Math.max(1, Math.min(Number(limit) || 100, 500));
    let scoped = (db.auditEvents || []).filter((e) => e.tenant_id === session.tenant_id);
    if (!(allUsers && session.role === "admin")) {
      scoped = scoped.filter((e) => e.user_id === session.user_id);
    }
    return scoped
      .slice()
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, max)
      .map((event) => {
        const actor = db.users.find((u) => u.id === event.user_id);
        return {
          id: event.id,
          tenant_id: event.tenant_id,
          user_id: event.user_id || null,
          user_name: actor ? actor.name : null,
          action: event.action,
          entity: event.entity,
          message: event.message || null,
          metadata: event.metadata || null,
          created_at: event.created_at || null,
        };
      });
  }
}

// ---------- ReportService ----------

class ReportService {
  async monthlyReport(allUsers = false) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const scoped = db.expenses.filter((e) => e.tenant_id === session.tenant_id);
    const filtered =
      allUsers && session.role === "admin" ? scoped : scoped.filter((e) => e.user_id === session.user_id);

    const totals = {};
    filtered.forEach((e) => {
      const ym = e.date.slice(0, 7);
      totals[ym] = (totals[ym] || 0) + e.amount;
    });

    return Object.keys(totals)
      .sort()
      .map((month) => ({ month, total: totals[month] }));
  }

  async categoryReport(allUsers = false) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const scoped = db.expenses.filter((e) => e.tenant_id === session.tenant_id);
    const filtered =
      allUsers && session.role === "admin" ? scoped : scoped.filter((e) => e.user_id === session.user_id);

    const totals = {};
    filtered.forEach((e) => {
      const category = db.categories.find((c) => c.id === e.category_id);
      const label = category ? category.name : "Sem categoria";
      totals[label] = (totals[label] || 0) + e.amount;
    });

    return Object.keys(totals)
      .sort((a, b) => totals[b] - totals[a])
      .map((category) => ({ category, total: totals[category] }));
  }

  async getMonthlyProjection(month) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const targetMonth = monthRegexOk(month) ? month : nowIso().slice(0, 7);
    const [year, mon] = targetMonth.split("-").map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate;
    const currentMonth = nowIso().slice(0, 7);
    const elapsedDays = targetMonth === currentMonth
      ? Math.min(new Date().getDate(), daysInMonth)
      : daysInMonth;
    const expenses = db.expenses.filter(
      (e) =>
        e.tenant_id === session.tenant_id &&
        e.user_id === session.user_id &&
        String(e.date || "").slice(0, 7) === targetMonth
    );
    const totalSpent = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const avgPerDay = elapsedDays > 0 ? totalSpent / elapsedDays : 0;
    const projectedTotal = avgPerDay * daysInMonth;

    const budget = db.budgets.find(
      (b) => b.tenant_id === session.tenant_id && b.user_id === session.user_id && b.month === targetMonth
    );
    const limit = Number((budget && budget.limit_value) || 0);
    const projectedPercent = limit > 0 ? Math.round((projectedTotal / limit) * 100) : 0;
    const projectedOverBudget = limit > 0 && projectedTotal > limit;

    return {
      month: targetMonth,
      elapsed_days: elapsedDays,
      total_days: daysInMonth,
      total_spent: totalSpent,
      average_per_day: avgPerDay,
      projected_total: projectedTotal,
      limit,
      projected_percent: projectedPercent,
      projected_over_budget: projectedOverBudget,
    };
  }

  async getMonthlyCloseChecklist(month) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const targetMonth = monthRegexOk(month) ? month : nowIso().slice(0, 7);
    const expenses = db.expenses.filter(
      (e) =>
        e.tenant_id === session.tenant_id &&
        e.user_id === session.user_id &&
        String(e.date || "").slice(0, 7) === targetMonth
    );
    const uncategorized = expenses.filter((e) => !e.category_id).length;
    const missingReceipt = expenses.filter((e) => !String(e.transaction_number || "").trim()).length;
    const hasMonthlyBudget = db.budgets.some(
      (b) => b.tenant_id === session.tenant_id && b.user_id === session.user_id && b.month === targetMonth
    );
    const hasCategoryBudget = (db.categoryBudgets || []).some(
      (b) => b.tenant_id === session.tenant_id && b.month === targetMonth
    );

    const checklist = [
      { id: "categorized", label: "Classificar todas as despesas do mês", done: uncategorized === 0 },
      { id: "receipts", label: "Conferir comprovantes (número da transação) das despesas", done: missingReceipt === 0 },
      { id: "monthly-budget", label: "Definir limite geral do mês", done: hasMonthlyBudget },
      { id: "category-budget", label: "Aplicar orçamento por categoria no mês", done: hasCategoryBudget },
    ];
    const doneCount = checklist.filter((item) => item.done).length;

    return {
      month: targetMonth,
      expenses_count: expenses.length,
      uncategorized_count: uncategorized,
      missing_receipt_count: missingReceipt,
      checklist,
      done_count: doneCount,
      total_count: checklist.length,
      progress_percent: checklist.length ? Math.round((doneCount / checklist.length) * 100) : 0,
    };
  }

  async getConsolidatedExportData(month) {
    const targetMonth = monthRegexOk(month) ? month : nowIso().slice(0, 7);
    const expenses = await Api.listExpenses();
    const monthExpenses = expenses.filter((e) => String(e.date || "").slice(0, 7) === targetMonth);
    const budgetOverview = await Api.getBudgetOverview(targetMonth);
    const alerts = await Api.getAlerts(targetMonth);
    const projection = await this.getMonthlyProjection(targetMonth);
    const closeChecklist = await this.getMonthlyCloseChecklist(targetMonth);
    return {
      exported_at: nowIso(),
      month: targetMonth,
      summary: {
        total_expenses: monthExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
        total_budget_limit: Number(alerts.limit || 0),
      },
      expenses: monthExpenses,
      budget_overview: budgetOverview,
      monthly_projection: projection,
      monthly_close_checklist: closeChecklist,
    };
  }
}

// ---------- BudgetLayoutService: layout de leitura de orçamento ----------
// Salvos pelo modal "Configurar layout de leitura" (view Importar
// Orçamento, js/dashboard.js) e consumidos por BudgetAI.analyzeWithLayout
// (js/budget-ai.js) na hora de ler uma planilha enviada pelo usuário.

class BudgetLayoutService {
  async listBudgetLayouts() {
    const session = Auth.requireSession();
    const db = await loadDb();
    return db.budgetLayouts
      .filter((l) => l.tenant_id === session.tenant_id)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveBudgetLayout(layout) {
    const session = Auth.requireSession();
    const db = await loadDb();

    const name = (layout.name || "").trim();
    if (!name) throw new Error("Dê um nome para o layout.");
    if (layout.format !== "longo" && layout.format !== "largo") {
      throw new Error("Formato de layout inválido.");
    }
    if (layout.format === "longo") {
      if (!layout.headerRow || !layout.colCategoria || !layout.colMes || !layout.colPrevisto || !layout.colRealizado) {
        throw new Error("No formato longo, todos os campos são obrigatórios.");
      }
    }
    if (layout.format === "largo") {
      if (!layout.colCategoriaLarga || !layout.monthRow || !layout.subHeaderRow) {
        throw new Error("No formato largo, todos os campos são obrigatórios.");
      }
    }

    const fields = {
      name,
      format: layout.format,
      sheetName: layout.sheetName || null,
      headerRow: layout.headerRow || null,
      colCategoria: layout.colCategoria || null,
      colMes: layout.colMes || null,
      colPrevisto: layout.colPrevisto || null,
      colRealizado: layout.colRealizado || null,
      colCategoriaLarga: layout.colCategoriaLarga || null,
      monthRow: layout.monthRow || null,
      subHeaderRow: layout.subHeaderRow || null,
    };

    // Edita por id se veio um (editando um layout existente); senão, se já
    // existir um layout com o mesmo nome deste tenant, atualiza em vez de
    // duplicar.
    let record = layout.id
      ? db.budgetLayouts.find((l) => l.id === layout.id && l.tenant_id === session.tenant_id)
      : db.budgetLayouts.find((l) => l.tenant_id === session.tenant_id && l.name === name);

    if (record) {
      Object.assign(record, fields);
    } else {
      record = { id: nextId(db, "budgetLayouts"), tenant_id: session.tenant_id, created_at: nowIso(), ...fields };
      db.budgetLayouts.push(record);
    }

    await saveDb(db);
    return record;
  }

  async deleteBudgetLayout(id) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const before = db.budgetLayouts.length;
    db.budgetLayouts = db.budgetLayouts.filter((l) => !(l.id === id && l.tenant_id === session.tenant_id));
    await saveDb(db);
    if (db.budgetLayouts.length === before) throw new Error("Layout não encontrado");
    return { ok: true };
  }
}

// ---------- PaymentService: histórico de pagamentos via Pix ----------
// Persistido junto com o resto do "banco" (Firestore + fallback em
// localStorage, ver js/db.js), em vez de uma chave solta separada no
// localStorage — assim o histórico também sincroniza entre dispositivos.

class PaymentService {
  async listPayments(allUsers = false) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const scoped = db.payments.filter((p) => p.tenant_id === session.tenant_id);
    const filtered =
      allUsers && session.role === "admin" ? scoped : scoped.filter((p) => p.user_id === session.user_id);
    return filtered
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((p) => {
        const user = db.users.find((u) => u.id === p.user_id);
        return {
          ...p,
          user_name: user ? user.name : null,
        };
      });
  }

  async addPayment({ type, plan, amount, txid, verifiedByAI, aiClassification, manualTxnNumber }) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const payment = {
      id: nextId(db, "payments"),
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      type,
      plan: plan || null,
      amount,
      txid,
      verifiedByAI: !!verifiedByAI,
      aiClassification: aiClassification || null,
      // Nº da transação digitado pelo usuário (ManualTransactionModal, ver
      // js/dashboard.js) quando a leitura automática do comprovante (OCR)
      // não foi possível. Só serve como referência para conferência manual
      // -- não é validado contra nenhum banco de verdade.
      manualTxnNumber: manualTxnNumber || null,
      date: nowIso(),
    };
    db.payments.push(payment);
    appendAuditEvent(db, {
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      action: "payment.created",
      entity: "payment",
      message: `Pagamento registrado (${type || "desconhecido"})`,
      metadata: {
        payment_id: payment.id,
        type: payment.type || null,
        plan: payment.plan || null,
        amount: Number(payment.amount) || 0,
        txid: payment.txid || null,
        verified_by_ai: !!payment.verifiedByAI,
      },
    });
    await saveDb(db);
    return payment;
  }
}

// ---------- AdService: anúncios internos da conta (tenant) ----------

class AdService {
  _sanitizeUrl(url, { required = false, fieldLabel = "URL" } = {}) {
    const value = String(url || "").trim();
    if (!value) {
      if (required) throw new Error(`${fieldLabel} é obrigatória.`);
      return null;
    }
    if (!/^https?:\/\//i.test(value)) {
      throw new Error(`${fieldLabel} deve começar com http:// ou https://.`);
    }
    return value;
  }

  _serialize(ad) {
    return {
      id: ad.id,
      title: ad.title,
      description: ad.description || "",
      image_url: ad.image_url || null,
      target_url: ad.target_url,
      cta_label: ad.cta_label || "Saiba mais",
      is_active: !!ad.is_active,
      placement: ad.placement || "landing",
      created_at: ad.created_at || null,
      updated_at: ad.updated_at || null,
      user_id: ad.user_id,
      tenant_id: ad.tenant_id,
    };
  }

  async listAds({ onlyActive = false, placement = null } = {}) {
    const session = Auth.requireSession();
    const db = await loadDb();
    let scoped = (db.ads || []).filter((ad) => ad.tenant_id === session.tenant_id);
    if (onlyActive) scoped = scoped.filter((ad) => !!ad.is_active);
    if (placement) scoped = scoped.filter((ad) => (ad.placement || "landing") === String(placement));
    return scoped
      .slice()
      .sort((a, b) => (String(a.updated_at || a.created_at || "") < String(b.updated_at || b.created_at || "") ? 1 : -1))
      .map((ad) => this._serialize(ad));
  }

  async createAd({ title, description, image_url, target_url, cta_label, is_active, placement } = {}) {
    const session = Auth.requireAdmin();
    const cleanTitle = String(title || "").trim();
    if (!cleanTitle) throw new Error("Título do anúncio é obrigatório.");
    const db = await loadDb();
    const ad = {
      id: nextId(db, "ads"),
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      title: cleanTitle,
      description: String(description || "").trim(),
      image_url: this._sanitizeUrl(image_url, { fieldLabel: "URL da imagem" }),
      target_url: this._sanitizeUrl(target_url, { required: true, fieldLabel: "URL de destino" }),
      cta_label: String(cta_label || "Saiba mais").trim() || "Saiba mais",
      is_active: is_active !== undefined ? !!is_active : true,
      placement: String(placement || "landing").trim() || "landing",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    db.ads = db.ads || [];
    db.ads.push(ad);
    await saveDb(db);
    return this._serialize(ad);
  }

  async updateAd(id, { title, description, image_url, target_url, cta_label, is_active, placement } = {}) {
    const session = Auth.requireAdmin();
    const db = await loadDb();
    const ad = (db.ads || []).find((item) => item.id === id && item.tenant_id === session.tenant_id);
    if (!ad) throw new Error("Anúncio não encontrado.");

    if (title !== undefined) {
      const cleanTitle = String(title || "").trim();
      if (!cleanTitle) throw new Error("Título do anúncio é obrigatório.");
      ad.title = cleanTitle;
    }
    if (description !== undefined) ad.description = String(description || "").trim();
    if (image_url !== undefined) ad.image_url = this._sanitizeUrl(image_url, { fieldLabel: "URL da imagem" });
    if (target_url !== undefined) ad.target_url = this._sanitizeUrl(target_url, { required: true, fieldLabel: "URL de destino" });
    if (cta_label !== undefined) ad.cta_label = String(cta_label || "").trim() || "Saiba mais";
    if (is_active !== undefined) ad.is_active = !!is_active;
    if (placement !== undefined) ad.placement = String(placement || "").trim() || "landing";
    ad.updated_at = nowIso();

    await saveDb(db);
    return this._serialize(ad);
  }

  async deleteAd(id) {
    const session = Auth.requireAdmin();
    const db = await loadDb();
    const before = (db.ads || []).length;
    db.ads = (db.ads || []).filter((ad) => !(ad.id === id && ad.tenant_id === session.tenant_id));
    await saveDb(db);
    if ((db.ads || []).length === before) throw new Error("Anúncio não encontrado.");
    return { ok: true };
  }
}

// ---------- ProfileService: conta do usuário, privacidade (LGPD) e dados
// institucionais — usado pelas telas "Configurações" e "Privacidade" ----------

class ProfileService {
  // ---- Configurações: perfil da conta ----

  // "document" (CPF ou CNPJ) é opcional, mas é exigido pela Receita/prefeitura
  // como dado do TOMADOR para emitir uma Nota Fiscal de Serviço (NFS-e) de
  // verdade — ver orcamento_agent/nfse_issuer.py. Sem ele, pagamentos deste
  // usuário ficam com nfseStatus "aguardando_documento_tomador" em vez de
  // uma nota emitida. Aceita CPF (11 dígitos) ou CNPJ (14 dígitos); qualquer
  // outra formatação (pontos/traço/barra) é aceita na digitação e normalizada
  // aqui, guardando só os dígitos.
  async updateProfile({ name, document }) {
    const session = Auth.requireSession();
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("Informe um nome.");

    const digits = String(document || "").replace(/\D/g, "");
    if (digits && digits.length !== 11 && digits.length !== 14) {
      throw new Error("CPF deve ter 11 dígitos ou CNPJ 14 dígitos.");
    }

    const db = await loadDb();
    const user = db.users.find((u) => u.id === session.user_id);
    if (!user) throw new Error("Usuário não encontrado.");
    user.name = cleanName;
    // Só mexe no documento fiscal se o chamador realmente passou o campo
    // (mesmo vazio, para permitir limpar) — evita apagar um documento já
    // salvo quando algum outro chamador futuro atualizar só o nome.
    if (document !== undefined) user.tax_document = digits || null;
    await saveDb(db);

    // Reemitir os tokens OAuth com o nome novo já nas claims, para a UI
    // (sidebar, saudação, etc.) refletir a mudança sem precisar deslogar —
    // ver OAuth.issueSessionTokens em js/oauth.js.
    if (typeof OAuth !== "undefined") {
      const tokens = await OAuth.issueSessionTokens({
        user_id: user.id,
        tenant_id: user.tenant_id,
        name: user.name,
        role: user.role,
        email: user.email,
      });
      Auth.setToken(JSON.stringify(tokens));
    }
    return { id: user.id, name: user.name, email: user.email, role: user.role, tax_document: user.tax_document || null };
  }

  async changePassword({ currentPassword, newPassword }) {
    const session = Auth.requireSession();
    if (!newPassword || newPassword.length < 6) {
      throw new Error("A nova senha deve ter pelo menos 6 caracteres.");
    }

    const db = await loadDb();
    const user = db.users.find((u) => u.id === session.user_id);
    if (!user) throw new Error("Usuário não encontrado.");

    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      throw new Error("Senha atual incorreta.");
    }

    user.password_hash = await hashPassword(newPassword);
    await saveDb(db);
    return { ok: true };
  }

  // Dados institucionais fixos da empresa que opera a plataforma (não
  // depende de sessão — é informação pública/legal, igual em qualquer
  // conta), extraídos do CNPJ/CMC/Alvará (ver COMPANY_PROFILE acima).
  async getCompanyProfile() {
    return COMPANY_PROFILE;
  }

  // ---- Privacidade (LGPD, Lei 13.709/2018) ----

  async getPrivacyConsent() {
    const session = Auth.requireSession();
    const db = await loadDb();
    const user = db.users.find((u) => u.id === session.user_id);
    return {
      marketing: !!(user && user.consent_marketing),
      updated_at: (user && user.consent_updated_at) || null,
    };
  }

  async setPrivacyConsent({ marketing }) {
    const session = Auth.requireSession();
    const db = await loadDb();
    const user = db.users.find((u) => u.id === session.user_id);
    if (!user) throw new Error("Usuário não encontrado.");
    user.consent_marketing = !!marketing;
    user.consent_updated_at = nowIso();
    await saveDb(db);
    return { ok: true, marketing: user.consent_marketing };
  }

  // Portabilidade de dados (LGPD, art. 18, V) — reúne tudo que este usuário/
  // conta tem no sistema (sem o password_hash) para download em JSON.
  async exportMyData() {
    const session = Auth.requireSession();
    const db = await loadDb();

    const tenant = TenantRepository.find(db, session.tenant_id);
    const user = db.users.find((u) => u.id === session.user_id);
    const categories = db.categories.filter((c) => c.tenant_id === session.tenant_id);
    const expenses = db.expenses.filter((e) => e.tenant_id === session.tenant_id && e.user_id === session.user_id);
    const budgets = db.budgets.filter((b) => b.tenant_id === session.tenant_id && b.user_id === session.user_id);
    const categoryBudgets = db.categoryBudgets.filter((b) => b.tenant_id === session.tenant_id);
    const budgetGroups = (db.budgetGroups || []).filter((g) => g.tenant_id === session.tenant_id);
    const payments = db.payments.filter((p) => p.tenant_id === session.tenant_id && p.user_id === session.user_id);
    const ads = (db.ads || []).filter((a) => a.tenant_id === session.tenant_id);

    return {
      exported_at: nowIso(),
      titular: user
        ? { id: user.id, name: user.name, email: user.email, role: user.role, tax_document: user.tax_document || null, created_at: user.created_at }
        : null,
      conta: tenant ? TenantRepository.serialize(tenant) : null,
      categorias: categories,
      despesas: expenses,
      orcamentos_mensais: budgets,
      orcamentos_por_categoria: categoryBudgets,
      grupos_orcamento: budgetGroups,
      pagamentos: payments,
      anuncios: ads,
      controlador_dos_dados: COMPANY_PROFILE,
    };
  }

  // Exclusão de conta (LGPD, art. 18, VI — eliminação dos dados). Remove o
  // usuário e, se ele for o único desta conta (tenant), remove também a
  // conta inteira e tudo o que pertence a ela. Se restarem outros usuários
  // no tenant, remove só o usuário (suas despesas/orçamentos próprios
  // continuam existindo para fins de histórico da conta, como pagamentos já
  // registrados — comportamento equivalente a "sair da equipe").
  async deleteAccount() {
    const session = Auth.requireSession();
    const db = await loadDb();

    const remainingUsers = db.users.filter((u) => u.tenant_id === session.tenant_id && u.id !== session.user_id);
    const tenantRemoved = remainingUsers.length === 0;

    if (tenantRemoved) {
      db.tenants = db.tenants.filter((t) => t.id !== session.tenant_id);
      db.users = db.users.filter((u) => u.tenant_id !== session.tenant_id);
      db.categories = db.categories.filter((c) => c.tenant_id !== session.tenant_id);
      db.expenses = db.expenses.filter((e) => e.tenant_id !== session.tenant_id);
      db.budgets = db.budgets.filter((b) => b.tenant_id !== session.tenant_id);
      db.payments = db.payments.filter((p) => p.tenant_id !== session.tenant_id);
      db.ads = (db.ads || []).filter((a) => a.tenant_id !== session.tenant_id);
      db.budgetLayouts = db.budgetLayouts.filter((l) => l.tenant_id !== session.tenant_id);
      db.categoryBudgets = db.categoryBudgets.filter((b) => b.tenant_id !== session.tenant_id);
      db.budgetGroups = (db.budgetGroups || []).filter((g) => g.tenant_id !== session.tenant_id);
    } else {
      db.users = db.users.filter((u) => u.id !== session.user_id);
    }

    await saveDb(db);
    Auth.clearToken();
    return { ok: true, tenant_removed: tenantRemoved };
  }
}

// ---------- ApiFacade: compõe os serviços acima com a interface pública
// que o resto do sistema já usa (Api.signup, Api.addExpense, ...) ----------

class ApiFacade {
  constructor() {
    this.authService = new AuthService();
    this.planService = new PlanService();
    this.userService = new UserService();
    this.categoryService = new CategoryService();
    this.expenseRuleService = new ExpenseRuleService();
    this.expenseService = new ExpenseService();
    this.budgetService = new BudgetService();
    this.categoryBudgetService = new CategoryBudgetService();
    this.budgetGroupService = new BudgetGroupService();
    this.auditTrailService = new AuditTrailService();
    this.reportService = new ReportService();
    this.budgetLayoutService = new BudgetLayoutService();
    this.paymentService = new PaymentService();
    this.adService = new AdService();
    this.profileService = new ProfileService();
  }

  // ---------- Auth ----------
  signup(payload) {
    return this.authService.signup(payload);
  }
  login(payload) {
    return this.authService.login(payload);
  }
  me() {
    return this.authService.me();
  }

  // ---------- Plans ----------
  plans() {
    return this.planService.plans();
  }
  changePlan(plan) {
    return this.planService.changePlan(plan);
  }

  // ---------- Users (equipe do tenant) ----------
  listUsers() {
    return this.userService.listUsers();
  }
  inviteUser(payload) {
    return this.userService.inviteUser(payload);
  }

  // ---------- Categories ----------
  listCategories() {
    return this.categoryService.listCategories();
  }
  addCategory(name) {
    return this.categoryService.addCategory(name);
  }

  // ---------- Regras automáticas de categoria ----------
  listExpenseRules() {
    return this.expenseRuleService.listExpenseRules();
  }
  addExpenseRule(payload) {
    return this.expenseRuleService.addExpenseRule(payload);
  }
  deleteExpenseRule(id) {
    return this.expenseRuleService.deleteExpenseRule(id);
  }

  // ---------- Expenses ----------
  listExpenses(allUsers = false) {
    return this.expenseService.listExpenses(allUsers);
  }
  getExpenseQuota() {
    return this.expenseService.getExpenseQuota();
  }
  addExpense(payload) {
    return this.expenseService.addExpense(payload);
  }
  updateExpense(id, payload) {
    return this.expenseService.updateExpense(id, payload);
  }
  deleteExpense(id) {
    return this.expenseService.deleteExpense(id);
  }
  applyExpenseRulesToUncategorized(payload = {}) {
    return this.expenseService.applyRulesToUncategorized(payload);
  }

  // ---------- Budgets & Alerts ----------
  setBudget(payload) {
    return this.budgetService.setBudget(payload);
  }
  listBudgets() {
    return this.budgetService.listBudgets();
  }
  deleteBudget(id) {
    return this.budgetService.deleteBudget(id);
  }
  getAlerts(month) {
    return this.budgetService.getAlerts(month);
  }

  // ---------- Category Budgets ----------
  listCategoryBudgets(month) {
    return this.categoryBudgetService.listCategoryBudgets(month);
  }
  setCategoryBudget(payload) {
    return this.categoryBudgetService.setCategoryBudget(payload);
  }
  deleteCategoryBudget(id) {
    return this.categoryBudgetService.deleteCategoryBudget(id);
  }
  getBudgetImportQuota() {
    return this.categoryBudgetService.getBudgetImportQuota();
  }
  importCategoryBudgets(payload) {
    return this.categoryBudgetService.importCategoryBudgets(payload);
  }
  getBudgetOverview(month) {
    return this.categoryBudgetService.getBudgetOverview(month);
  }
  copyCategoryBudgetsRecurring(payload) {
    return this.categoryBudgetService.copyCategoryBudgetsRecurring(payload);
  }
  listBudgetGroups() {
    return this.budgetGroupService.listBudgetGroups();
  }
  listAuditTrail(filters) {
    return this.auditTrailService.listAuditTrail(filters);
  }

  // ---------- Reports ----------
  monthlyReport(allUsers = false) {
    return this.reportService.monthlyReport(allUsers);
  }
  categoryReport(allUsers = false) {
    return this.reportService.categoryReport(allUsers);
  }
  getMonthlyProjection(month) {
    return this.reportService.getMonthlyProjection(month);
  }
  getMonthlyCloseChecklist(month) {
    return this.reportService.getMonthlyCloseChecklist(month);
  }
  getConsolidatedExportData(month) {
    return this.reportService.getConsolidatedExportData(month);
  }

  // ---------- Budget Layouts ----------
  listBudgetLayouts() {
    return this.budgetLayoutService.listBudgetLayouts();
  }
  saveBudgetLayout(layout) {
    return this.budgetLayoutService.saveBudgetLayout(layout);
  }
  deleteBudgetLayout(id) {
    return this.budgetLayoutService.deleteBudgetLayout(id);
  }

  // ---------- Payments ----------
  listPayments(allUsers = false) {
    return this.paymentService.listPayments(allUsers);
  }
  addPayment(payload) {
    return this.paymentService.addPayment(payload);
  }

  // ---------- Ads ----------
  listAds(filters) {
    return this.adService.listAds(filters);
  }
  createAd(payload) {
    return this.adService.createAd(payload);
  }
  updateAd(id, payload) {
    return this.adService.updateAd(id, payload);
  }
  deleteAd(id) {
    return this.adService.deleteAd(id);
  }

  // ---------- Perfil / Configurações ----------
  updateProfile(payload) {
    return this.profileService.updateProfile(payload);
  }
  changePassword(payload) {
    return this.profileService.changePassword(payload);
  }
  getCompanyProfile() {
    return this.profileService.getCompanyProfile();
  }

  // ---------- Privacidade (LGPD) ----------
  getPrivacyConsent() {
    return this.profileService.getPrivacyConsent();
  }
  setPrivacyConsent(payload) {
    return this.profileService.setPrivacyConsent(payload);
  }
  exportMyData() {
    return this.profileService.exportMyData();
  }
  deleteAccount() {
    return this.profileService.deleteAccount();
  }

  // ---------- Mercado Pago (resumo para o badge da sidebar) ----------
  // Agrega, num único objeto, o que orcamento_agent/mp_expenses.py já gerou
  // (despesas reais, generated_by_mercado_pago) e o que mp_reconcile.py já
  // confirmou (pagamentos com verifiedByMercadoPago) para o usuário logado —
  // ambos scripts rodam fora do navegador e só chegam aqui via Firestore/
  // localStorage (ver js/db.js). Não chama a API do Mercado Pago diretamente
  // (nenhum Access Token existe no front-end, de propósito).
  //
  // "automation": além do resumo derivado de expenses/payments acima, expõe
  // o que os agentes gravaram sobre a PRÓPRIA execução deles (StatusTracker,
  // em orcamento_agent/mp_reconcile.py) -- horário e contagens da última vez
  // que cada script rodou de verdade (manual, agendado ou via GitHub
  // Actions), mesmo em janelas sem nenhuma despesa/pagamento novo. `null`
  // enquanto nenhum agente rodou ainda (db.mercado_pago_status inexistente).
  async getMercadoPagoStatus() {
    const session = Auth.requireSession();
    const [db, expenses, payments] = await Promise.all([loadDb(), this.listExpenses(), this.listPayments()]);
    const mpExpenses = expenses.filter((e) => e.generated_by_mercado_pago);
    const mpPayments = payments.filter((p) => p.verifiedByMercadoPago);
    const expensesTotal = mpExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const lastSyncDate =
      [...mpExpenses.map((e) => e.date), ...mpPayments.map((p) => p.date)]
        .filter(Boolean)
        .sort()
        .pop() || null;

    const statusByTenant = (db.mercado_pago_status && db.mercado_pago_status[session.tenant_id]) || {};
    const statusGlobal = (db.mercado_pago_status && db.mercado_pago_status.global) || {};
    const automation = {
      last_reconcile: statusGlobal.last_reconcile || null,
      last_expenses_api: statusByTenant.last_expenses_api || null,
      last_open_finance_sync: statusByTenant.last_open_finance_sync || null,
      last_oauth_account_sync: statusByTenant.last_oauth_account_sync || null,
    };
    const lastRunAt =
      [
        automation.last_reconcile,
        automation.last_expenses_api,
        automation.last_open_finance_sync,
        automation.last_oauth_account_sync,
      ]
        .filter(Boolean)
        .map((s) => s.at)
        .filter(Boolean)
        .sort()
        .pop() || null;

    return {
      connected: mpExpenses.length > 0 || mpPayments.length > 0,
      expenses_count: mpExpenses.length,
      expenses_total: expensesTotal,
      payments_verified_count: mpPayments.length,
      last_sync_date: lastSyncDate,
      automation,
      automation_configured: lastRunAt !== null,
      last_run_at: lastRunAt,
    };
  }

  async getMarketplaceCustomerProfile(month) {
    Auth.requireScope("marketplace:ai_agent");
    const session = Auth.requireSession();
    const [db, marketplaceStatus] = await Promise.all([loadDb(), this.getMercadoPagoStatus()]);
    const targetMonth = monthRegexOk(month) ? month : nowIso().slice(0, 7);
    const tenantCategories = (db.categories || []).filter((c) => c.tenant_id === session.tenant_id);
    const tenantBudgets = (db.categoryBudgets || []).filter((b) => b.tenant_id === session.tenant_id && b.month === targetMonth);
    const tenantExpenses = (db.expenses || []).filter((e) => e.tenant_id === session.tenant_id && String(e.date || "").slice(0, 7) === targetMonth);

    const totalBudget = tenantBudgets.reduce((sum, b) => sum + (Number(b.previsto) || 0), 0);
    const totalSpent = tenantExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const budgetUsage = totalBudget > 0 ? (totalSpent / totalBudget) : null;
    const mpShare = totalSpent > 0 ? (Number(marketplaceStatus.expenses_total || 0) / totalSpent) : 0;

    const spentByCategory = new Map();
    tenantExpenses.forEach((expense) => {
      const cat = expense.category_id ? tenantCategories.find((c) => c.id === expense.category_id) : null;
      const label = cat ? cat.name : "Sem categoria";
      spentByCategory.set(label, (spentByCategory.get(label) || 0) + (Number(expense.amount) || 0));
    });
    const topCategory = Array.from(spentByCategory.entries()).sort((a, b) => b[1] - a[1])[0] || null;

    let segment = "Em formação";
    if (budgetUsage !== null && budgetUsage > 1) segment = "Risco de estouro";
    else if (budgetUsage !== null && budgetUsage >= 0.85) segment = "Atenção ao orçamento";
    else if (marketplaceStatus.connected && mpShare >= 0.35) segment = "Cliente digital orientado a marketplace";
    else if ((tenantExpenses || []).length >= 8) segment = "Cliente recorrente";
    else if ((tenantExpenses || []).length > 0) segment = "Cliente em crescimento";

    const insights = [];
    if (totalBudget > 0) insights.push(`Consumo de orçamento: ${(Math.max(0, budgetUsage) * 100).toFixed(1)}%`);
    if (topCategory) insights.push(`Categoria dominante: ${topCategory[0]} (R$ ${topCategory[1].toFixed(2)})`);
    if (marketplaceStatus.connected) {
      insights.push(`Marketplace ativo: ${marketplaceStatus.expenses_count} despesa(s) via Mercado Pago`);
    } else {
      insights.push("Marketplace ainda sem despesas sincronizadas");
    }

    return {
      month: targetMonth,
      segment,
      summary: `${segment} · ${insights.join(" · ")}`,
      metrics: {
        categories_count: tenantCategories.length,
        budgets_count: tenantBudgets.length,
        expenses_count: tenantExpenses.length,
        total_budget: totalBudget,
        total_spent: totalSpent,
        marketplace_share: mpShare,
      },
      insights,
    };
  }
}

const Api = new ApiFacade();
