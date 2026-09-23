// ===============================
// js/db.js
// "Banco de dados" local do app, agora usado apenas como fallback do front-end:
//
// 1) Backend Java — fonte principal quando a aplicação está ligada à API
//    REST (ver js/api.js).
//
// 2) localStorage — fallback seguro para uso estático/offline, sem qualquer
//    dependência de Firebase/Firestore.
//
// db.json continua existindo apenas como o banco "de fábrica": usado para
// popular o localStorage na primeiríssima vez que ESTE app é usado.
//
// Reescrito em POO: cada responsabilidade vira uma classe pequena e o
// orquestrador (Database) as compõe. loadDb/saveDb/nextId/nowIso/
// seedDefaultCategories/getSyncStatus/waitForPendingFirestoreWrites
// continuam existindo como funções globais (mesma interface usada por
// js/api.js e tests/*.test.js), agora delegando para a instância única
// `DB` abaixo.
// ===============================

const DB_JSON_KEY =
  ((typeof globalThis !== "undefined" && globalThis.__FINTECH_DB_KEY__)
    ? String(globalThis.__FINTECH_DB_KEY__)
    : "fintech_saas_db_v1"); // cache local / fallback (localStorage)
const DB_PENDING_SYNC_KEY = "fintech_saas_pending_sync_v1";
const DB_LAST_SYNCED_KEY = "fintech_saas_last_synced_v1";
const DB_SEED_JSON_URL = "db.json"; // banco "de fábrica", só para o 1º carregamento

function secureRandomBase36(size = 6) {
  const cryptoApi =
    (typeof globalThis !== "undefined" && globalThis.crypto)
    || (typeof window !== "undefined" && window.crypto)
    || null;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    return Date.now().toString(36).slice(-size).padEnd(size, "0");
  }
  const bytes = new Uint8Array(size);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

const DEFAULT_CATEGORIES = ["Alimentação", "Transporte", "Moradia", "Lazer", "Saúde", "Outros", "Mercado Pago"];
const DB_COLLECTIONS = [
  "tenants", "users", "categories", "expenses", "budgets", "payments", "budgetLayouts", "categoryBudgets", "budgetGroups", "expenseRules", "auditEvents",
];

// Campos que guardam um id (próprio ou de outra coleção/"FK"), por
// coleção — usados para normalizar tudo como string (ver Schema.coerceIds).
const ID_FIELDS_BY_COLLECTION = {
  tenants: ["id"],
  users: ["id", "tenant_id"],
  categories: ["id", "tenant_id"],
  expenses: ["id", "tenant_id", "user_id", "category_id"],
  budgets: ["id", "tenant_id", "user_id"],
  payments: ["id", "tenant_id", "user_id"],
  budgetLayouts: ["id", "tenant_id"],
  categoryBudgets: ["id", "tenant_id", "category_id"],
  budgetGroups: ["id", "tenant_id", "budget_category_id", "expense_category_id"],
  expenseRules: ["id", "tenant_id", "category_id"],
  auditEvents: ["id", "tenant_id", "user_id"],
};

// ---------- Schema: forma dos dados (schema vazio + normalização) ----------

class Schema {
  static normalizeLegacyMercadoPagoCategory(value) {
    const raw = String(value || "").trim();
    if (!raw) return raw;
    return /^mercado\s+pago\s*\(\s*n[aã]o\s+categorizado\s*\)$/i.test(raw)
      ? "Mercado Pago"
      : raw;
  }

  static normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  static canonicalCategoryName(value) {
    const raw = String(value || "").trim();
    if (!raw) return raw;
    const normalized = Schema.normalizeText(raw);
    const defaultName = DEFAULT_CATEGORIES.find((name) => Schema.normalizeText(name) === normalized);
    return defaultName || raw;
  }

  static deduplicateCategories(db) {
    const categories = Array.isArray(db.categories) ? db.categories : [];
    if (!categories.length) return db;

    const canonicalIdByKey = new Map();
    const duplicateToCanonical = new Map();
    const deduped = [];

    categories.forEach((category) => {
      if (!category || category.id === null || category.id === undefined) return;
      category.id = String(category.id);
      if (category.tenant_id !== null && category.tenant_id !== undefined) category.tenant_id = String(category.tenant_id);
      category.name = Schema.canonicalCategoryName(Schema.normalizeLegacyMercadoPagoCategory(category.name));
      const tenantKey = category.tenant_id || "";
      const normalizedName = Schema.normalizeText(category.name);
      const key = normalizedName ? `${tenantKey}::${normalizedName}` : `${tenantKey}::id::${category.id}`;

      if (!canonicalIdByKey.has(key)) {
        canonicalIdByKey.set(key, category.id);
        deduped.push(category);
        return;
      }

      duplicateToCanonical.set(category.id, canonicalIdByKey.get(key));
    });

    db.categories = deduped;
    if (!duplicateToCanonical.size) return db;

    const remapCategoryId = (value) => {
      if (value === null || value === undefined) return value;
      const key = String(value);
      return duplicateToCanonical.get(key) || key;
    };

    (db.expenses || []).forEach((expense) => {
      expense.category_id = remapCategoryId(expense.category_id);
    });
    (db.categoryBudgets || []).forEach((budget) => {
      budget.category_id = remapCategoryId(budget.category_id);
    });
    (db.expenseRules || []).forEach((rule) => {
      rule.category_id = remapCategoryId(rule.category_id);
    });
    if (Array.isArray(db.budgetGroups)) {
      const seen = new Set();
      db.budgetGroups = db.budgetGroups.filter((group) => {
        group.budget_category_id = remapCategoryId(group.budget_category_id);
        group.expense_category_id = remapCategoryId(group.expense_category_id);
        const key = `${String(group.tenant_id || "")}::${String(group.budget_category_id || "")}::${String(group.expense_category_id || "")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return db;
  }

  static detachBudgetGeneratedCategories(db) {
    const expenses = Array.isArray(db.expenses) ? db.expenses : [];
    const rules = Array.isArray(db.expenseRules) ? db.expenseRules : [];
    const budgets = Array.isArray(db.categoryBudgets) ? db.categoryBudgets : [];
    const budgetGroups = Array.isArray(db.budgetGroups) ? db.budgetGroups : [];
    const categories = Array.isArray(db.categories) ? db.categories : [];

    const usedByExpense = new Set(expenses.map((e) => e.category_id).filter(Boolean));
    const usedByRule = new Set(rules.map((r) => r.category_id).filter(Boolean));
    const defaultByName = new Set(DEFAULT_CATEGORIES.map((name) => Schema.normalizeText(name)));
    const budgetCategoryIds = new Set(budgets.map((b) => b.category_id).filter(Boolean));

    const removableIds = new Set();
    categories.forEach((category) => {
      const categoryName = Schema.normalizeText(category.name);
      const referencedByBudgetOnly =
        budgetCategoryIds.has(category.id) &&
        !usedByExpense.has(category.id) &&
        !usedByRule.has(category.id);
      const explicitlyBudgetCreated = !!category.created_from_budget;
      if ((explicitlyBudgetCreated || referencedByBudgetOnly) && !defaultByName.has(categoryName)) {
        removableIds.add(category.id);
      }
    });

    if (!removableIds.size) {
      budgets.forEach((budget) => {
        if (!budget.category_name && budget.category_id) {
          const category = categories.find((c) => c.id === budget.category_id);
          if (category) budget.category_name = category.name;
        }
        budget.category_name_normalized = Schema.normalizeText(budget.category_name);
      });
      return db;
    }

    db.categories = categories.filter((c) => !removableIds.has(c.id));
    db.categoryBudgets = budgets.map((budget) => {
      const clone = { ...budget };
      if (removableIds.has(clone.category_id)) {
        const oldCategory = categories.find((c) => c.id === clone.category_id);
        clone.category_name = clone.category_name || (oldCategory ? oldCategory.name : null);
        clone.category_id = null;
      }
      clone.category_name_normalized = Schema.normalizeText(clone.category_name);
      return clone;
    });
    db.budgetGroups = budgetGroups.filter(
      (group) => !removableIds.has(group.budget_category_id) && !removableIds.has(group.expense_category_id)
    );
    return db;
  }

  static empty() {
    return {
      tenants: [], // { id, name, plan, created_at }
      users: [], // { id, tenant_id, name, email, password_hash, role, created_at }
      categories: [], // { id, tenant_id, name }
      expenses: [], // { id, tenant_id, user_id, category_id, amount, date, description, created_at, is_extra, extra_charge }
      budgets: [], // { id, tenant_id, user_id, limit_value, month } -- limite geral (1 valor/mês, sem categoria)
      payments: [], // { id, tenant_id, user_id, type, plan, amount, txid, verifiedByAI, aiClassification, date }
      // Layouts de leitura salvos no modal "Configurar layout de leitura"
      // (view Importar Orçamento) -- descrevem como ler uma planilha de
      // orçamento (aba, formato longo/largo, linhas e colunas) em vez de
      // depender só da heurística automática do js/budget-ai.js.
      budgetLayouts: [], // { id, tenant_id, name, format, sheetName, headerRow, colCategoria, colMes, colPrevisto, colRealizado, colCategoriaLarga, monthRow, subHeaderRow, created_at }
      // Previsto por categoria/mês, "adotado" a partir da leitura de uma
      // planilha (Página 1 do fluxo Orçamento & Despesas -- ver
      // Api.importCategoryBudgets em js/api.js). Compartilhado pelo tenant
      // (não por usuário, ao contrário de "budgets" acima) -- é o orçamento
      // da conta, não de uma pessoa só. O Realizado NÃO é guardado aqui: é
      // calculado na hora a partir de "expenses" (ver Api.getBudgetOverview).
      categoryBudgets: [], // { id, tenant_id, category_id, month, previsto }
      budgetGroups: [], // { id, tenant_id, name, budget_category_id, expense_category_id, created_at, auto_created }
      expenseRules: [], // { id, tenant_id, category_id, keyword, keyword_normalized, match_type, created_at }
      // Trilha de auditoria financeira do tenant (governança): eventos
      // críticos do fluxo principal (despesas, orçamento, pagamentos, plano
      // e equipe). Usado para rastreabilidade operacional no Feed.
      auditEvents: [], // { id, tenant_id, user_id, action, entity, message, metadata, created_at }
      // Resumo (contagens + horário) da última execução de cada agente
      // Mercado Pago (orcamento_agent/mp_reconcile.py, mp_expenses.py),
      // gravado por eles mesmos via StatusTracker (Python) direto no
      // backend/db.json -- nunca editado pelo navegador. Formato:
      // { [tenant_id ou "global"]: { last_reconcile, last_expenses_api } },
      // cada um { ...contagens, at: isoString }. Usado só para exibir
      // "última sincronização" no painel (ver Api.getMercadoPagoStatus em
      // js/api.js) -- puramente informativo. `null` até a primeira
      // execução de algum dos agentes.
      mercado_pago_status: null,
      _seq: {
        tenants: 0, users: 0, categories: 0, expenses: 0, budgets: 0, payments: 0, budgetLayouts: 0, categoryBudgets: 0, budgetGroups: 0, expenseRules: 0, auditEvents: 0,
      },
    };
  }

  // Garante que todo id (e toda referência a id de outra coleção) seja
  // sempre uma string — inclusive em bancos antigos, de antes desta versão,
  // que tinham ids numéricos sequenciais (1, 2, 3…). Sem isso, comparações
  // como `categoria.id === despesa.category_id` podiam falhar por diferença
  // de tipo (number vs. string) dependendo de onde cada valor veio (JSON
  // salvo vs. valor lido de um <select> no formulário, por exemplo).
  static coerceIds(db) {
    DB_COLLECTIONS.forEach((key) => {
      const fields = ID_FIELDS_BY_COLLECTION[key] || [];
      (db[key] || []).forEach((rec) => {
        fields.forEach((f) => {
          if (rec[f] !== null && rec[f] !== undefined) rec[f] = String(rec[f]);
        });
      });
    });
    return db;
  }

  static normalize(parsed) {
    const base = Schema.empty();
    const merged = { ...base, ...parsed, _seq: { ...base._seq, ...(parsed._seq || {}) } };
    (merged.categories || []).forEach((category) => {
      if (category && typeof category.name === "string") {
        category.name = Schema.normalizeLegacyMercadoPagoCategory(category.name);
      }
    });
    (merged.expenses || []).forEach((expense) => {
      if (expense && typeof expense.category_name === "string") {
        expense.category_name = Schema.normalizeLegacyMercadoPagoCategory(expense.category_name);
      }
    });
    (merged.budgets || []).forEach((budget) => {
      if (budget && typeof budget.category_name === "string") {
        budget.category_name = Schema.normalizeLegacyMercadoPagoCategory(budget.category_name);
      }
    });
    (merged.categoryBudgets || []).forEach((budget) => {
      if (budget && typeof budget.category_name === "string") {
        budget.category_name = Schema.normalizeLegacyMercadoPagoCategory(budget.category_name);
      }
    });
    Schema.deduplicateCategories(merged);
    Schema.detachBudgetGeneratedCategories(merged);
    return Schema.coerceIds(merged);
  }
}

// ---------- LocalCache: localStorage ----------

class LocalCache {
  constructor(keys) {
    this.dbKey = keys.db;
    this.pendingKey = keys.pending;
    this.lastSyncedKey = keys.lastSynced;
  }

  read() {
    const raw = localStorage.getItem(this.dbKey);
    if (!raw) return null;
    try {
      return Schema.normalize(JSON.parse(raw));
    } catch (e) {
      console.warn("Spacecworp Despesas Pessoais: JSON salvo em localStorage estava corrompido; ignorando.", e);
      return null;
    }
  }

  write(db) {
    try {
      localStorage.setItem(this.dbKey, JSON.stringify(db));
    } catch (e) {
      console.warn("Spacecworp Despesas Pessoais: não foi possível gravar no localStorage.", e);
    }
  }

  markPending(pending) {
    try {
      if (pending) localStorage.setItem(this.pendingKey, "1");
      else localStorage.removeItem(this.pendingKey);
    } catch (e) {
      // localStorage indisponível (ex.: modo privado muito restrito); segue sem marcar.
    }
  }

  hasPending() {
    try {
      return localStorage.getItem(this.pendingKey) === "1";
    } catch (e) {
      return false;
    }
  }

  readLastSynced() {
    try {
      const raw = localStorage.getItem(this.lastSyncedKey);
      return raw ? Schema.normalize(JSON.parse(raw)) : null;
    } catch (e) {
      return null;
    }
  }

  writeLastSynced(db) {
    try {
      localStorage.setItem(this.lastSyncedKey, JSON.stringify(db));
    } catch (e) {
      // não crítico: mantido por compatibilidade com versões anteriores.
    }
  }
}

// ---------- SeedLoader: db.json (banco de fábrica) ----------

class SeedLoader {
  constructor(url) {
    this.url = url;
  }

  // Só é chamado quando não há NADA salvo no localStorage
  // ainda (1º uso). Se falhar (ex.: abrindo o login.html direto via
  // file://, onde fetch() de arquivos locais costuma ser bloqueado por
  // CORS), segue sem erro e o app parte de um schema vazio, como sempre fez.
  async fetchSeed() {
    if (typeof fetch !== "function") return null;
    try {
      const res = await fetch(this.url, { cache: "no-store" });
      if (res.ok) return Schema.normalize(await res.json());
    } catch (e) {
      console.warn("Spacecworp Despesas Pessoais: não foi possível carregar o banco de fábrica (db.json).", e);
    }
    return null;
  }
}

// ---------- Database: orquestra cache local ----------

class Database {
  constructor(cache, seedLoader) {
    this.cache = cache;
    this.seedLoader = seedLoader;
    this._firestoreWriteQueue = Promise.resolve();
  }

  async load() {
    const local = this.cache.read();
    if (local) return local;

    // Primeira visita: parte do banco de fábrica db.json.
    const seeded = await this.seedLoader.fetchSeed();
    if (seeded) {
      this.cache.write(seeded);
      return seeded;
    }

    // Sem nada acessível: schema vazio, do zero.
    const fresh = Schema.empty();
    this.cache.write(fresh);
    return fresh;
  }

  async save(db) {
    this.cache.write(db);
    this.cache.markPending(false);
    this.cache.writeLastSynced(db);
  }

  waitForPendingWrites() {
    return this._firestoreWriteQueue;
  }

  nextId(db, collectionName) {
    // Ids são strings, geradas de forma praticamente única (timestamp em
    // base36 + sufixo aleatório) — não mais um contador sequencial simples.
    // Isso evita colisão quando dois dispositivos criam registros na mesma
    // coleção enquanto cada um está com sua própria cópia local (ex.: um
    // deles offline), e depois sincronizam: com um contador sequencial por
    // dispositivo, dois registros diferentes podiam nascer com o mesmo id
    // (ex.: "a despesa nº 4" de dois navegadores distintos) e um acabava
    // apagando o outro na hora do merge.
    db._seq[collectionName] = (db._seq[collectionName] || 0) + 1; // mantido só para depuração/compatibilidade
    const ts = Date.now().toString(36);
    const rand = secureRandomBase36(6);
    return `${collectionName}_${ts}_${rand}`;
  }

  seedDefaultCategories(db, tenantId) {
    const tenantKey = String(tenantId);
    DEFAULT_CATEGORIES.forEach((name) => {
      const normalizedDefaultName = Schema.normalizeText(name);
      const exists = db.categories.some((c) => {
        if (!c) return false;
        if (String(c.tenant_id || "") !== tenantKey) return false;
        return Schema.normalizeText(Schema.normalizeLegacyMercadoPagoCategory(c.name)) === normalizedDefaultName;
      });
      if (!exists) {
        db.categories.push({ id: this.nextId(db, "categories"), tenant_id: tenantKey, name: Schema.canonicalCategoryName(name) });
      }
    });
  }

  static nowIso() {
    return new Date().toISOString();
  }

  getSyncStatus() {
    return { state: "local", label: "Modo local (dados salvos neste navegador)" };
  }
}

const DB = new Database(
  new LocalCache({ db: DB_JSON_KEY, pending: DB_PENDING_SYNC_KEY, lastSynced: DB_LAST_SYNCED_KEY }),
  new SeedLoader(DB_SEED_JSON_URL)
);

// ---------- API pública (camada de compatibilidade) ----------

async function loadDb() {
  return DB.load();
}

async function saveDb(db) {
  return DB.save(db);
}

function waitForPendingFirestoreWrites() {
  return DB.waitForPendingWrites();
}

function nextId(db, collectionName) {
  return DB.nextId(db, collectionName);
}

function seedDefaultCategories(db, tenantId) {
  return DB.seedDefaultCategories(db, tenantId);
}

function nowIso() {
  return Database.nowIso();
}

function getSyncStatus() {
  return DB.getSyncStatus();
}
