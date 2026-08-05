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
//    espera rede) e, em segundo plano (sem bloquear quem chamou saveDb),
//    tenta sincronizar com o Firestore. Se a sincronização falhar, fica
//    marcada como pendente e é retentada automaticamente (evento "online"
//    do navegador, retry periódico a cada 20s, ou próxima chamada a
//    loadDb/saveDb).
//
// db.json continua existindo apenas como o banco "de fábrica": usado para
// popular o Firestore/localStorage na primeiríssima vez que ESTE app é
// usado (nenhum dado no Firestore e nenhum dado no localStorage ainda).
// ===============================

const DB_JSON_KEY = "fintech_saas_db_v1"; // cache local / fallback (localStorage)
const DB_PENDING_SYNC_KEY = "fintech_saas_pending_sync_v1"; // flag: há mudanças locais ainda não enviadas ao Firestore
const DB_LAST_SYNCED_KEY = "fintech_saas_last_synced_v1"; // "base" do último merge bem-sucedido com o Firestore (ver _threeWayMerge)
const DB_SEED_JSON_URL = "db.json"; // banco "de fábrica", só para o 1º carregamento

const DEFAULT_CATEGORIES = ["Alimentação", "Transporte", "Moradia", "Lazer", "Saúde", "Outros"];
const DB_COLLECTIONS = ["tenants", "users", "categories", "expenses", "budgets", "payments", "budgetLayouts"];

function _emptySchema() {
  return {
    tenants: [], // { id, name, plan, created_at }
    users: [], // { id, tenant_id, name, email, password_hash, role, created_at }
    categories: [], // { id, tenant_id, name }
    expenses: [], // { id, tenant_id, user_id, category_id, amount, date, description, created_at, is_extra, extra_charge }
    budgets: [], // { id, tenant_id, user_id, limit_value, month }
    payments: [], // { id, tenant_id, user_id, type, plan, amount, txid, verifiedByAI, aiClassification, date }
    // Layouts de leitura salvos no modal "Configurar layout de leitura"
    // (view Importar Orçamento) -- descrevem como ler uma planilha de
    // orçamento (aba, formato longo/largo, linhas e colunas) em vez de
    // depender só da heurística automática do js/budget-ai.js.
    budgetLayouts: [], // { id, tenant_id, name, format, sheetName, headerRow, colCategoria, colMes, colPrevisto, colRealizado, colCategoriaLarga, monthRow, subHeaderRow, created_at }
    _seq: { tenants: 0, users: 0, categories: 0, expenses: 0, budgets: 0, payments: 0, budgetLayouts: 0 },
  };
}

// Campos que guardam um id (próprio ou de outra coleção/"FK"), por
// coleção — usados para normalizar tudo como string (ver _coerceIds).
const ID_FIELDS_BY_COLLECTION = {
  tenants: ["id"],
  users: ["id", "tenant_id"],
  categories: ["id", "tenant_id"],
  expenses: ["id", "tenant_id", "user_id", "category_id"],
  budgets: ["id", "tenant_id", "user_id"],
  payments: ["id", "tenant_id", "user_id"],
  budgetLayouts: ["id", "tenant_id"],
};

// Garante que todo id (e toda referência a id de outra coleção) seja
// sempre uma string — inclusive em bancos antigos, de antes desta versão,
// que tinham ids numéricos sequenciais (1, 2, 3…). Sem isso, comparações
// como `categoria.id === despesa.category_id` podiam falhar por diferença
// de tipo (number vs. string) dependendo de onde cada valor veio (JSON
// salvo vs. valor lido de um <select> no formulário, por exemplo).
function _coerceIds(db) {
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

function _normalize(parsed) {
  const base = _emptySchema();
  const merged = { ...base, ...parsed, _seq: { ...base._seq, ...(parsed._seq || {}) } };
  return _coerceIds(merged);
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

// "Base" do último estado que sabemos, com certeza, que estava igual nos
// dois lados (local e Firestore) — usada para calcular o merge de 3 vias
// quando este dispositivo volta a ficar online depois de ter feito
// alterações offline (ver _threeWayMerge/trySyncPending).
function _readLastSynced() {
  try {
    const raw = localStorage.getItem(DB_LAST_SYNCED_KEY);
    return raw ? _normalize(JSON.parse(raw)) : null;
  } catch (e) {
    return null;
  }
}

function _writeLastSynced(db) {
  try {
    localStorage.setItem(DB_LAST_SYNCED_KEY, JSON.stringify(db));
  } catch (e) {
    // não crítico: na pior das hipóteses, o próximo merge trata tudo como "novo".
  }
}

function _byId(arr) {
  const map = new Map();
  (arr || []).forEach((rec) => map.set(rec.id, rec));
  return map;
}

// Merge de 3 vias, coleção por coleção (mesma ideia de "git merge"):
// - "base"   = último estado que já esteve sincronizado nos dois lados.
// - "local"  = estado atual deste dispositivo (pode ter criado, editado ou
//              apagado registros enquanto o Firestore estava indisponível).
// - "remote" = o que está no Firestore agora (pode ter mudanças de OUTROS
//              dispositivos feitas nesse meio tempo).
//
// Resultado: parte do "remote" (preserva o que outros dispositivos fizeram)
// e aplica por cima as mudanças deste dispositivo desde a "base" — inclusive
// exclusões. Sem isso, reconectar depois de ficar offline podia sobrescrever
// e apagar dados que outro dispositivo tinha sincronizado nesse intervalo.
function _threeWayMerge(base, local, remote) {
  const merged = _emptySchema();

  DB_COLLECTIONS.forEach((key) => {
    const baseMap = _byId(base && base[key]);
    const localMap = _byId(local && local[key]);
    const remoteMap = _byId(remote && remote[key]);
    const result = new Map(remoteMap);

    // Exclusões feitas neste dispositivo (existia na base, não existe mais localmente).
    baseMap.forEach((_rec, id) => {
      if (!localMap.has(id)) result.delete(id);
    });

    // Criações/edições feitas neste dispositivo (id novo, ou conteúdo
    // diferente do que havia na base).
    localMap.forEach((rec, id) => {
      const baseRec = baseMap.get(id);
      if (!baseRec || JSON.stringify(baseRec) !== JSON.stringify(rec)) {
        result.set(id, rec);
      }
    });

    merged[key] = Array.from(result.values());
  });

  merged._seq = {};
  Object.keys(_emptySchema()._seq).forEach((k) => {
    merged._seq[k] = Math.max(
      (base && base._seq && base._seq[k]) || 0,
      (local && local._seq && local._seq[k]) || 0,
      (remote && remote._seq && remote._seq[k]) || 0
    );
  });

  return merged;
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
//
// Antes de gravar, busca o estado atual no Firestore e faz um merge de 3
// vias com a última base sincronizada (ver _threeWayMerge) — em vez de
// simplesmente sobrescrever o documento com o que ficou salvo localmente.
// Isso preserva mudanças que outros dispositivos tenham sincronizado
// enquanto este ficou offline.
async function trySyncPending() {
  if (!_hasPendingSync()) return false;
  const local = _readLocalStorage();
  if (!local) {
    _markPendingSync(false);
    return false;
  }

  try {
    let toWrite = local;
    try {
      const remote = await _readFirestore();
      if (remote) {
        const base = _readLastSynced() || remote;
        toWrite = _threeWayMerge(base, local, remote);
      }
    } catch (e) {
      // Não conseguiu ler o remoto agora (ainda offline?) — tenta de novo depois.
      throw e;
    }

    const ok = await _writeFirestore(toWrite);
    if (ok) {
      _writeLocalStorage(toWrite); // cache local reflete o resultado do merge
      _writeLastSynced(toWrite);
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

// Retry periódico "de segurança": cobre os casos em que ficamos pendentes
// sem um evento "online" claro para reagir (ex.: Firestore respondeu com
// erro mesmo com rede presente, aba ficou em segundo plano e perdeu o
// evento, etc.). Roda a cada 20s e só faz algo quando há pendência —
// custo desprezível no caso comum (nenhuma pendência).
if (typeof window !== "undefined" && window.setInterval) {
  window.setInterval(() => {
    if (_hasPendingSync()) trySyncPending();
  }, 20000);
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
        _writeLastSynced(remote); // local e remoto estão idênticos neste momento
        return remote;
      }

      // Documento ainda não existe no Firestore: usa o que já tiver
      // localmente (localStorage) ou o banco de fábrica, e envia pro
      // Firestore para "adotar" esse conteúdo como ponto de partida
      // (migração automática do que já existia antes do Firebase).
      const local = _readLocalStorage();
      if (local) {
        try {
          await _writeFirestore(local);
          _writeLastSynced(local);
        } catch (e) {
          _markPendingSync(true);
        }
        return local;
      }

      const seeded = (await _fetchSeedDb()) || _emptySchema();
      _writeLocalStorage(seeded);
      try {
        await _writeFirestore(seeded);
        _writeLastSynced(seeded);
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

// Fila que serializa as gravações no Firestore, para que rodem em segundo
// plano SEM bloquear quem chamou saveDb (ver abaixo) mas ainda assim na
// ordem certa — evita que uma gravação mais recente seja sobrescrita por
// uma mais antiga caso a rede responda fora de ordem.
let _firestoreWriteQueue = Promise.resolve();

async function saveDb(db) {
  // Grava local sempre primeiro: rápido, síncrono na prática, nunca
  // depende de rede — garante que nada se perde mesmo sem Firebase, e já
  // deixa a interface livre para continuar sem esperar a rede.
  _writeLocalStorage(db);

  if (!_firestoreAvailable() || !getFirestoreDocRef()) {
    // Firebase não configurado: comportamento igual ao de antes (só localStorage).
    return;
  }

  // Sincroniza com o Firebase em segundo plano: saveDb() retorna assim que
  // o localStorage é gravado, sem esperar o round-trip de rede do
  // Firestore. Isso agiliza toda ação da UI (criar despesa, mudar plano,
  // etc.), que antes ficava bloqueada até o Firestore confirmar a escrita.
  // Fica marcado como pendente até a gravação em nuvem realmente terminar;
  // se a aba fechar antes disso, o próximo carregamento retenta via
  // trySyncPending().
  _markPendingSync(true);
  _firestoreWriteQueue = _firestoreWriteQueue.then(() =>
    _writeFirestore(db)
      .then(() => {
        _writeLastSynced(db); // local e remoto ficam idênticos após esta gravação
        _markPendingSync(false);
      })
      .catch((e) => {
        console.warn(
          "Fintech Spacecworp: não foi possível sincronizar com o Firebase agora (offline ou erro); os dados estão seguros no localStorage e serão sincronizados automaticamente depois.",
          e
        );
        _markPendingSync(true);
      })
  );
}

// Permite que quem realmente precisar esperar a confirmação do Firebase
// (ex.: testes automatizados) possa fazê-lo — uso normal do app não
// precisa disso, já que saveDb() não bloqueia mais.
function waitForPendingFirestoreWrites() {
  return _firestoreWriteQueue;
}

function nextId(db, collectionName) {
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
  const rand = Math.random().toString(36).slice(2, 8);
  return `${collectionName}_${ts}_${rand}`;
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

// ---------- status de sincronização (para exibir na UI) ----------
//
// Leitura síncrona e barata (só olha flags no localStorage + config),
// pensada para ser chamada com frequência pela UI (ex.: dashboard.js)
// sem custo de rede. Estados possíveis:
//   "local"   — Firebase não configurado; app funciona só com localStorage.
//   "error"   — Firebase configurado, mas a inicialização falhou (config inválida?).
//   "pending" — há gravações locais aguardando sincronizar com o Firestore.
//   "synced"  — Firebase configurado e sem pendências (dados sincronizados).
function getSyncStatus() {
  const configured = typeof isFirebaseConfigured === "function" && isFirebaseConfigured();
  if (!configured) return { state: "local", label: "Modo local (Firebase não configurado)" };

  if (typeof _firebaseInitFailed !== "undefined" && _firebaseInitFailed) {
    return { state: "error", label: "Firebase configurado, mas falhou ao iniciar — usando localStorage" };
  }

  if (_hasPendingSync()) {
    return { state: "pending", label: "Sincronização pendente (offline ou instável)" };
  }

  return { state: "synced", label: "Sincronizado com o Firebase" };
}
