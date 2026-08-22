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
//
// Reescrito em POO: cada responsabilidade vira uma classe pequena e o
// orquestrador (Database) as compõe. loadDb/saveDb/nextId/nowIso/
// seedDefaultCategories/getSyncStatus/waitForPendingFirestoreWrites
// continuam existindo como funções globais (mesma interface usada por
// js/api.js e tests/*.test.js), agora delegando para a instância única
// `DB` abaixo.
// ===============================

const DB_JSON_KEY = "fintech_saas_db_v1"; // cache local / fallback (localStorage)
const DB_PENDING_SYNC_KEY = "fintech_saas_pending_sync_v1"; // flag: há mudanças locais ainda não enviadas ao Firestore
const DB_LAST_SYNCED_KEY = "fintech_saas_last_synced_v1"; // "base" do último merge bem-sucedido com o Firestore (ver ThreeWayMerger)
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
  "tenants", "users", "categories", "expenses", "budgets", "payments", "ads", "budgetLayouts", "categoryBudgets", "budgetGroups", "expenseRules", "auditEvents",
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
  ads: ["id", "tenant_id", "user_id"],
  budgetLayouts: ["id", "tenant_id"],
  categoryBudgets: ["id", "tenant_id", "category_id"],
  budgetGroups: ["id", "tenant_id", "budget_category_id", "expense_category_id"],
  expenseRules: ["id", "tenant_id", "category_id"],
  auditEvents: ["id", "tenant_id", "user_id"],
};

// ---------- Schema: forma dos dados (schema vazio + normalização) ----------

class Schema {
  static normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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
      ads: [], // { id, tenant_id, user_id, title, description, image_url, target_url, cta_label, is_active, placement, created_at, updated_at }
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
      // Firestore/db.json -- nunca editado pelo navegador. Formato:
      // { [tenant_id ou "global"]: { last_reconcile, last_expenses_api } },
      // cada um { ...contagens, at: isoString }. Usado só para exibir
      // "última sincronização" no painel (ver Api.getMercadoPagoStatus em
      // js/api.js) -- puramente informativo. `null` até a primeira
      // execução de algum dos agentes.
      mercado_pago_status: null,
      _seq: {
        tenants: 0, users: 0, categories: 0, expenses: 0, budgets: 0, payments: 0, ads: 0, budgetLayouts: 0, categoryBudgets: 0, budgetGroups: 0, expenseRules: 0, auditEvents: 0,
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
    Schema.detachBudgetGeneratedCategories(merged);
    return Schema.coerceIds(merged);
  }
}

// ---------- LocalCache: localStorage (fallback / cache offline) ----------

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
      console.warn("Fintech Spacecworp: JSON salvo em localStorage estava corrompido; ignorando.", e);
      return null;
    }
  }

  write(db) {
    try {
      localStorage.setItem(this.dbKey, JSON.stringify(db));
    } catch (e) {
      console.warn("Fintech Spacecworp: não foi possível gravar no localStorage.", e);
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

  // "Base" do último estado que sabemos, com certeza, que estava igual nos
  // dois lados (local e Firestore) — usada para calcular o merge de 3 vias
  // quando este dispositivo volta a ficar online depois de ter feito
  // alterações offline (ver ThreeWayMerger/Database.trySyncPending).
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
      // não crítico: na pior das hipóteses, o próximo merge trata tudo como "novo".
    }
  }
}

// ---------- ThreeWayMerger: merge de 3 vias entre dispositivos ----------

class ThreeWayMerger {
  static _byId(arr) {
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
  static merge(base, local, remote) {
    const merged = Schema.empty();

    DB_COLLECTIONS.forEach((key) => {
      const baseMap = ThreeWayMerger._byId(base && base[key]);
      const localMap = ThreeWayMerger._byId(local && local[key]);
      const remoteMap = ThreeWayMerger._byId(remote && remote[key]);
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
    Object.keys(Schema.empty()._seq).forEach((k) => {
      merged._seq[k] = Math.max(
        (base && base._seq && base._seq[k]) || 0,
        (local && local._seq && local._seq[k]) || 0,
        (remote && remote._seq && remote._seq[k]) || 0
      );
    });

    // mercado_pago_status: campo escrito só pelos agentes Python
    // (orcamento_agent/mp_reconcile.py etc., via Firestore .update() -- ver
    // StatusTracker), nunca pelo navegador. Não é uma coleção por id, então
    // fica fora do merge por DB_COLLECTIONS acima -- sem isto, _writeFirestore
    // (que faz ref.set(db), sobrescrevendo o documento inteiro) apagaria o
    // status na próxima sincronização pendente. "remote" é a fonte mais
    // fresca (o agente grava direto lá, o navegador nunca vê isso em
    // "local" a não ser que já tenha sincronizado antes).
    merged.mercado_pago_status =
      (remote && remote.mercado_pago_status) || (local && local.mercado_pago_status) || (base && base.mercado_pago_status) || null;

    return merged;
  }
}

// ---------- SeedLoader: db.json (banco de fábrica) ----------

class SeedLoader {
  constructor(url) {
    this.url = url;
  }

  // Só é chamado quando não há NADA salvo no Firestore nem no localStorage
  // ainda (1º uso). Se falhar (ex.: abrindo o login.html direto via
  // file://, onde fetch() de arquivos locais costuma ser bloqueado por
  // CORS), segue sem erro e o app parte de um schema vazio, como sempre fez.
  async fetchSeed() {
    if (typeof fetch !== "function") return null;
    try {
      const res = await fetch(this.url, { cache: "no-store" });
      if (res.ok) return Schema.normalize(await res.json());
    } catch (e) {
      console.warn("Fintech Spacecworp: não foi possível carregar o banco de fábrica (db.json).", e);
    }
    return null;
  }
}

// ---------- Database: orquestra Firestore + LocalCache + merge ----------

class Database {
  constructor(cache, seedLoader) {
    this.cache = cache;
    this.seedLoader = seedLoader;
    this._firestoreWriteQueue = Promise.resolve();
    this._registerAutoSync();
  }

  _registerAutoSync() {
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("online", () => this.trySyncPending());
    }
    // Retry periódico "de segurança": cobre os casos em que ficamos
    // pendentes sem um evento "online" claro para reagir (ex.: Firestore
    // respondeu com erro mesmo com rede presente, aba ficou em segundo
    // plano e perdeu o evento, etc.). Roda a cada 20s e só faz algo quando
    // há pendência — custo desprezível no caso comum (nenhuma pendência).
    if (typeof window !== "undefined" && window.setInterval) {
      window.setInterval(() => {
        if (this.cache.hasPending()) this.trySyncPending();
      }, 20000);
    }
  }

  firestoreAvailable() {
    return typeof getFirestoreDocRef === "function";
  }

  async _readFirestore() {
    if (!this.firestoreAvailable()) return null;
    const ref = getFirestoreDocRef();
    if (!ref) return null; // não configurado / SDK não carregado
    const snap = await ref.get();
    if (!snap.exists) return null;
    return Schema.normalize(snap.data());
  }

  async _writeFirestore(db) {
    if (!this.firestoreAvailable()) return false;
    const ref = getFirestoreDocRef();
    if (!ref) return false;
    await ref.set(db);
    return true;
  }

  // Tenta reenviar ao Firestore o que estiver pendente de sincronização
  // (gravações que aconteceram enquanto o Firebase estava indisponível).
  // Chamado automaticamente ao voltar a ficar online e no início de load().
  //
  // Antes de gravar, busca o estado atual no Firestore e faz um merge de 3
  // vias com a última base sincronizada (ver ThreeWayMerger) — em vez de
  // simplesmente sobrescrever o documento com o que ficou salvo localmente.
  // Isso preserva mudanças que outros dispositivos tenham sincronizado
  // enquanto este ficou offline.
  async trySyncPending() {
    if (!this.cache.hasPending()) return false;
    const local = this.cache.read();
    if (!local) {
      this.cache.markPending(false);
      return false;
    }

    try {
      let toWrite = local;
      try {
        const remote = await this._readFirestore();
        if (remote) {
          const base = this.cache.readLastSynced() || remote;
          toWrite = ThreeWayMerger.merge(base, local, remote);
        }
      } catch (e) {
        // Não conseguiu ler o remoto agora (ainda offline?) — tenta de novo depois.
        throw e;
      }

      const ok = await this._writeFirestore(toWrite);
      if (ok) {
        this.cache.write(toWrite); // cache local reflete o resultado do merge
        this.cache.writeLastSynced(toWrite);
        this.cache.markPending(false);
        console.info("Fintech Spacecworp: dados sincronizados com o Firebase.");
        return true;
      }
    } catch (e) {
      // Continua pendente; tenta de novo na próxima oportunidade.
    }
    return false;
  }

  async load() {
    // 0) Se há gravações locais pendentes de um momento sem Firebase,
    // tenta mandar pro Firestore antes de decidir de onde ler.
    await this.trySyncPending();

    // 1) Fonte primária: Firestore, se configurado e alcançável.
    if (this.firestoreAvailable() && getFirestoreDocRef()) {
      try {
        const remote = await this._readFirestore();
        if (remote) {
          this.cache.write(remote); // mantém o cache local em dia
          this.cache.writeLastSynced(remote); // local e remoto estão idênticos neste momento
          return remote;
        }

        // Documento ainda não existe no Firestore: usa o que já tiver
        // localmente (localStorage) ou o banco de fábrica, e envia pro
        // Firestore para "adotar" esse conteúdo como ponto de partida
        // (migração automática do que já existia antes do Firebase).
        const local = this.cache.read();
        if (local) {
          try {
            await this._writeFirestore(local);
            this.cache.writeLastSynced(local);
          } catch (e) {
            this.cache.markPending(true);
          }
          return local;
        }

        const seeded = (await this.seedLoader.fetchSeed()) || Schema.empty();
        this.cache.write(seeded);
        try {
          await this._writeFirestore(seeded);
          this.cache.writeLastSynced(seeded);
        } catch (e) {
          this.cache.markPending(true);
        }
        return seeded;
      } catch (e) {
        console.warn("Fintech Spacecworp: Firebase indisponível agora (offline ou erro); usando localStorage.", e);
        // cai para o fallback local abaixo
      }
    }

    // 2) Fallback: localStorage (já usado antes por este navegador).
    const local = this.cache.read();
    if (local) return local;

    // 3) Primeira visita (sem Firestore e sem localStorage): parte do banco de fábrica db.json.
    const seeded = await this.seedLoader.fetchSeed();
    if (seeded) {
      this.cache.write(seeded);
      return seeded;
    }

    // 4) Sem nada acessível: schema vazio, do zero.
    const fresh = Schema.empty();
    this.cache.write(fresh);
    return fresh;
  }

  async save(db) {
    // Grava local sempre primeiro: rápido, síncrono na prática, nunca
    // depende de rede — garante que nada se perde mesmo sem Firebase, e já
    // deixa a interface livre para continuar sem esperar a rede.
    this.cache.write(db);

    if (!this.firestoreAvailable() || !getFirestoreDocRef()) {
      // Firebase não configurado: comportamento igual ao de antes (só localStorage).
      return;
    }

    // Sincroniza com o Firebase em segundo plano: save() retorna assim que
    // o localStorage é gravado, sem esperar o round-trip de rede do
    // Firestore. Isso agiliza toda ação da UI (criar despesa, mudar plano,
    // etc.), que antes ficava bloqueada até o Firestore confirmar a escrita.
    // Fica marcado como pendente até a gravação em nuvem realmente terminar;
    // se a aba fechar antes disso, o próximo carregamento retenta via
    // trySyncPending().
    this.cache.markPending(true);
    this._firestoreWriteQueue = this._firestoreWriteQueue.then(() =>
      this._writeFirestore(db)
        .then(() => {
          this.cache.writeLastSynced(db); // local e remoto ficam idênticos após esta gravação
          this.cache.markPending(false);
        })
        .catch((e) => {
          console.warn(
            "Fintech Spacecworp: não foi possível sincronizar com o Firebase agora (offline ou erro); os dados estão seguros no localStorage e serão sincronizados automaticamente depois.",
            e
          );
          this.cache.markPending(true);
        })
    );
  }

  // Permite que quem realmente precisar esperar a confirmação do Firebase
  // (ex.: testes automatizados) possa fazê-lo — uso normal do app não
  // precisa disso, já que save() não bloqueia mais.
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
    DEFAULT_CATEGORIES.forEach((name) => {
      const exists = db.categories.some((c) => c.tenant_id === tenantId && c.name === name);
      if (!exists) {
        db.categories.push({ id: this.nextId(db, "categories"), tenant_id: tenantId, name });
      }
    });
  }

  static nowIso() {
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
  getSyncStatus() {
    const configured = typeof isFirebaseConfigured === "function" && isFirebaseConfigured();
    if (!configured) return { state: "local", label: "Modo local (Firebase não configurado)" };

    if (typeof firebaseGateway !== "undefined" && firebaseGateway.initFailed) {
      return { state: "error", label: "Firebase configurado, mas falhou ao iniciar — usando localStorage" };
    }

    if (this.cache.hasPending()) {
      return { state: "pending", label: "Sincronização pendente (offline ou instável)" };
    }

    return { state: "synced", label: "Sincronizado com o Firebase" };
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
