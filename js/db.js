// ===============================
// js/db.js
// "Banco de dados" 100% client-side, sem servidor.
//
// Fonte primária: db.json, um arquivo JSON versionado na raiz do
// repositório. Na primeira visita de um navegador (nada ainda salvo no
// localStorage), o app busca db.json via fetch() e usa esse conteúdo para
// inicializar o app.
//
// Fallback: localStorage. Como o site é 100% estático (GitHub Pages, sem
// backend), o navegador não tem como escrever de volta no db.json
// remoto — então toda gravação do dia a dia (despesas, planos, equipe
// etc.) acontece no localStorage, que também é o que é lido em qualquer
// visita depois da primeira. Ou seja: db.json é o ponto de partida;
// localStorage é onde o app efetivamente lê/escreve na prática.
// ===============================

const DB_JSON_KEY = "fintech_saas_db_v1"; // banco de dados (JSON) em localStorage — fallback/persistência real
const DB_SEED_JSON_URL = "db.json"; // banco "de fábrica", só para o 1º carregamento

const DEFAULT_CATEGORIES = ["Alimentação", "Transporte", "Moradia", "Lazer", "Saúde", "Outros"];

function _emptySchema() {
  return {
    tenants: [], // { id, name, plan, created_at }
    users: [], // { id, tenant_id, name, email, password_hash, role, created_at }
    categories: [], // { id, tenant_id, name }
    expenses: [], // { id, tenant_id, user_id, category_id, amount, date, description, created_at, is_extra, extra_charge }
    budgets: [], // { id, tenant_id, user_id, limit_value, month }
    _seq: { tenants: 0, users: 0, categories: 0, expenses: 0, budgets: 0 },
  };
}

function _normalize(parsed) {
  const base = _emptySchema();
  return { ...base, ...parsed, _seq: { ...base._seq, ...(parsed._seq || {}) } };
}

// ---------- localStorage (fallback / persistência real) ----------

function _readLocalStorage() {
  const raw = localStorage.getItem(DB_JSON_KEY);
  if (!raw) return null;
  try {
    return _normalize(JSON.parse(raw));
  } catch (e) {
    console.warn("Fintech Spacecworp: JSON salvo em localStorage estava corrompido; ignorando.", e);
    return null;
  }
}

function _writeLocalStorage(db) {
  try {
    localStorage.setItem(DB_JSON_KEY, JSON.stringify(db));
  } catch (e) {
    console.warn("Fintech Spacecworp: não foi possível gravar no localStorage.", e);
  }
}

// ---------- db.json (banco de fábrica) ----------

async function _fetchSeedDb() {
  // Só é chamado quando não há NADA salvo no localStorage ainda (1ª visita
  // deste navegador). Se falhar (ex.: abrindo o index.html direto via
  // file://, onde fetch() de arquivos locais costuma ser bloqueado por
  // CORS), segue sem erro e o app parte de um schema vazio, como sempre fez.
  if (typeof fetch !== "function") return null;
  try {
    const res = await fetch(DB_SEED_JSON_URL, { cache: "no-store" });
    if (res.ok) return _normalize(await res.json());
  } catch (e) {
    console.warn("Fintech Spacecworp: não foi possível carregar o banco de fábrica (db.json).", e);
  }
  return null;
}

// ---------- API pública ----------

async function loadDb() {
  // 1) Fallback/persistência real: localStorage (já usado antes por este navegador).
  const local = _readLocalStorage();
  if (local) return local;

  // 2) Primeira visita (localStorage vazio): parte do banco de fábrica db.json.
  const seeded = await _fetchSeedDb();
  if (seeded) {
    _writeLocalStorage(seeded);
    return seeded;
  }

  // 3) Sem localStorage e sem db.json acessível: schema vazio, do zero.
  const fresh = _emptySchema();
  _writeLocalStorage(fresh);
  return fresh;
}

async function saveDb(db) {
  _writeLocalStorage(db);
}

function nextId(db, collectionName) {
  db._seq[collectionName] = (db._seq[collectionName] || 0) + 1;
  return db._seq[collectionName];
}

function seedDefaultCategories(db, tenantId) {
  DEFAULT_CATEGORIES.forEach((name) => {
    const exists = db.categories.some((c) => c.tenant_id === tenantId && c.name === name);
    if (!exists) {
      db.categories.push({ id: nextId(db, "categories"), tenant_id: tenantId, name });
    }
  });
}

function nowIso() {
  return new Date().toISOString();
}
