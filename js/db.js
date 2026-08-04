// ===============================
// frontend/js/db.js
// "Banco de dados" 100% client-side, persistido em localStorage.
// Substitui o antigo backend Python (SQLite) por um schema equivalente
// guardado como JSON no navegador.
// ===============================

const DB_KEY = "fintech_saas_db_v1";

const DEFAULT_CATEGORIES = ["Alimentação", "Transporte", "Moradia", "Lazer", "Saúde", "Outros"];

function _emptySchema() {
  return {
    tenants: [], // { id, name, plan, created_at }
    users: [], // { id, tenant_id, name, email, password_hash, role, created_at }
    categories: [], // { id, tenant_id, name }
    expenses: [], // { id, tenant_id, user_id, category_id, amount, date, description, created_at }
    budgets: [], // { id, tenant_id, user_id, limit_value, month }
    _seq: { tenants: 0, users: 0, categories: 0, expenses: 0, budgets: 0 },
  };
}

function loadDb() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) {
    const fresh = _emptySchema();
    saveDb(fresh);
    return fresh;
  }
  try {
    const parsed = JSON.parse(raw);
    // garante que todas as coleções existem (proteção contra versões antigas)
    const base = _emptySchema();
    return { ...base, ...parsed, _seq: { ...base._seq, ...(parsed._seq || {}) } };
  } catch (e) {
    const fresh = _emptySchema();
    saveDb(fresh);
    return fresh;
  }
}

function saveDb(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
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
