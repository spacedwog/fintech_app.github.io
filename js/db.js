// ===============================
// js/db.js
// "Banco de dados" do app, agora com duas camadas:
//
// 1) Firestore (Firebase) — fonte primária, quando configurado (ver
//    js/firebase-config.js). Permite que os dados sincronizem entre
//    navegadores/dispositivos diferentes, ao contrário do localStorage
//    puro. Todo o "banco" é salvo como um único documento no Firestore
//    (mesmo formato usado no db.json/localStorage).
//
// 2) localStorage — fallback automático sempre que o Firestore não
//    estiver configurado, o SDK não tiver carregado, o navegador estiver
//    offline, ou a chamada ao Firestore falhar por qualquer motivo. Toda
//    gravação grava no localStorage IMEDIATAMENTE (nunca falha, nunca
//    espera rede) e, em paralelo, tenta sincronizar com o Firestore. Se a
//    sincronização falhar, fica marcada como pendente e é retentada
//    automaticamente (evento "online" do navegador, ou próxima chamada a
//    loadDb/saveDb).
//
// db.json continua existindo apenas como o banco "de fábrica": usado para
// popular o Firestore/localStorage na primeiríssima vez que ESTE app é
// usado (nenhum dado no Firestore e nenhum dado no localStorage ainda).
// ===============================

const DB_JSON_KEY = "fintech_saas_db_v1"; // cache local / fallback (localStorage)
const DB_PENDING_SYNC_KEY = "fintech_saas_pending_sync_v1"; // flag: há mudanças locais ainda não enviadas ao Firestore
const DB_SEED_JSON_URL = "db.json"; // banco "de fábrica", só para o 1º carregamento

const DEFAULT_CATEGORIES = ["Alimentação", "Transporte", "Moradia", "Lazer", "Saúde", "Outros"];

function _emptySchema() {
  return {
    tenants: [], // { id, name, plan, created_at }
    users: [], // { id, tenant_id, name, email, password_hash, role, created_at }
    categories: [], // { id, tenant_id, name }
    expenses: [], // { id, tenant_id, user_id, category_id, amount, date, description, created_at, is_extra, extra_charge }
    budgets: [], // { id, tenant_id, user_id, limit_value, month }
    payments: [], // { id, tenant_id, user_id, type, plan, amount, txid, verifiedByAI, aiClassification, date }
    _seq: { tenants: 0, users: 0, categories: 0, expenses: 0, budgets: 0, payments: 0 },
  };
}

function _normalize(parsed) {
  const base = _emptySchema();
  return { ...base, ...parsed, _seq: { ...base._seq, ...(parsed._seq || {}) } };
}

// ---------- localStorage (fallback / cache offline) ----------

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

function _markPendingSync(pending) {
  try {
    if (pending) localStorage.setItem(DB_PENDING_SYNC_KEY, "1");
    else localStorage.removeItem(DB_PENDING_SYNC_KEY);
  } catch (e) {
    // localStorage indisponível (ex.: modo privado muito restrito); segue sem marcar.
  }
}

function _hasPendingSync() {
  try {
    return localStorage.getItem(DB_PENDING_SYNC_KEY) === "1";
  } catch (e) {
    return false;
  }
}

// ---------- db.json (banco de fábrica) ----------

async function _fetchSeedDb() {
  // Só é chamado quando não há NADA salvo no Firestore nem no localStorage
  // ainda (1º uso). Se falhar (ex.: abrindo o login.html direto via
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

// ---------- Firestore (Firebase) ----------

function _firestoreAvailable() {
  return typeof getFirestoreDocRef === "function";
}

async function _readFirestore() {
  if (!_firestoreAvailable()) return null;
  const ref = getFirestoreDocRef();
  if (!ref) return null; // não configurado / SDK não carregado
  const snap = await ref.get();
  if (!snap.exists) return null;
  return _normalize(snap.data());
}

async function _writeFirestore(db) {
  if (!_firestoreAvailable()) return false;
  const ref = getFirestoreDocRef();
  if (!ref) return false;
  await ref.set(db);
  return true;
}

// Tenta reenviar ao Firestore o que estiver pendente de sincronização
// (gravações que aconteceram enquanto o Firebase estava indisponível).
// Chamado automaticamente ao voltar a ficar online e no início de loadDb().
async function trySyncPending() {
  if (!_hasPendingSync()) return false;
  const local = _readLocalStorage();
  if (!local) {
    _markPendingSync(false);
    return false;
  }
  try {
    const ok = await _writeFirestore(local);
    if (ok) {
      _markPendingSync(false);
      console.info("Fintech Spacecworp: dados sincronizados com o Firebase.");
      return true;
    }
  } catch (e) {
    // Continua pendente; tenta de novo na próxima oportunidade.
  }
  return false;
}

if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("online", () => {
    trySyncPending();
  });
}

// ---------- API pública ----------

async function loadDb() {
  // 0) Se há gravações locais pendentes de um momento sem Firebase,
  // tenta mandar pro Firestore antes de decidir de onde ler.
  await trySyncPending();

  // 1) Fonte primária: Firestore, se configurado e alcançável.
  if (_firestoreAvailable() && getFirestoreDocRef()) {
    try {
      const remote = await _readFirestore();
      if (remote) {
        _writeLocalStorage(remote); // mantém o cache local em dia
        return remote;
      }

      // Documento ainda não existe no Firestore: usa o que já tiver
      // localmente (localStorage) ou o banco de fábrica, e envia pro
      // Firestore para "adotar" esse conteúdo como ponto de partida.
      const local = _readLocalStorage();
      if (local) {
        try {
          await _writeFirestore(local);
        } catch (e) {
          _markPendingSync(true);
        }
        return local;
      }

      const seeded = (await _fetchSeedDb()) || _emptySchema();
      _writeLocalStorage(seeded);
      try {
        await _writeFirestore(seeded);
      } catch (e) {
        _markPendingSync(true);
      }
      return seeded;
    } catch (e) {
      console.warn("Fintech Spacecworp: Firebase indisponível agora (offline ou erro); usando localStorage.", e);
      // cai para o fallback local abaixo
    }
  }

  // 2) Fallback: localStorage (já usado antes por este navegador).
  const local = _readLocalStorage();
  if (local) return local;

  // 3) Primeira visita (sem Firestore e sem localStorage): parte do banco de fábrica db.json.
  const seeded = await _fetchSeedDb();
  if (seeded) {
    _writeLocalStorage(seeded);
    return seeded;
  }

  // 4) Sem nada acessível: schema vazio, do zero.
  const fresh = _emptySchema();
  _writeLocalStorage(fresh);
  return fresh;
}

async function saveDb(db) {
  // Grava local sempre primeiro: rápido, síncrono na prática, nunca
  // depende de rede — garante que nada se perde mesmo sem Firebase.
  _writeLocalStorage(db);

  if (!_firestoreAvailable() || !getFirestoreDocRef()) {
    // Firebase não configurado: comportamento igual ao de antes (só localStorage).
    return;
  }

  try {
    await _writeFirestore(db);
    _markPendingSync(false);
  } catch (e) {
    console.warn(
      "Fintech Spacecworp: não foi possível sincronizar com o Firebase agora (offline ou erro); os dados estão seguros no localStorage e serão sincronizados automaticamente depois.",
      e
    );
    _markPendingSync(true);
  }
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
