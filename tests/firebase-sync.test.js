// ===============================
// tests/firebase-sync.test.js
//
// Teste de integração (Node, sem dependências) que executa o CÓDIGO REAL
// do projeto (js/firebase-config.js + js/plans.js + js/db.js +
// js/crypto-utils.js + js/api.js, sem nenhuma modificação de lógica)
// contra um Firestore simulado (mesmo contrato assíncrono
// .collection().doc().get()/.set() do SDK real), para provar que:
//
//   1) dados que já existiam no localStorage (de antes do Firebase
//      configurado) migram automaticamente para o Firestore assim que
//      ele é configurado — usando as credenciais reais já coladas em
//      js/firebase-config.js;
//   2) um segundo dispositivo, com localStorage vazio, consegue ler
//      esses mesmos dados via Firestore (sincronização real entre
//      dispositivos);
//   3) se o Firestore cair, o app continua funcionando via localStorage
//      e marca a gravação como pendente;
//   4) ao voltar, a pendência é sincronizada SEM apagar mudanças que
//      outro dispositivo tenha sincronizado nesse meio tempo (merge de 3
//      vias em trySyncPending()/_threeWayMerge()).
//
// Este ambiente não abre uma conexão de rede real com o Firebase — o
// "Firestore" abaixo é um dublê fiel à API (mesmas Promises, mesmos
// métodos), não o serviço do Google. O que este teste comprova é a
// LÓGICA de js/db.js/js/api.js, byte a byte a mesma que roda no
// navegador do usuário.
//
// Como rodar:
//   node tests/firebase-sync.test.js
// ===============================

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

// ---------- Firestore simulado (compartilhado entre "dispositivos") ----------

function makeMockFirestore() {
  let doc = null;
  let broken = false;
  return {
    _setBroken(v) {
      broken = v;
    },
    _getRaw() {
      return doc;
    },
    collection(_name) {
      return {
        doc(_id) {
          return {
            async get() {
              if (broken) throw new Error("Firestore indisponível (simulado)");
              return {
                exists: doc !== null,
                data: () => (doc ? JSON.parse(JSON.stringify(doc)) : undefined),
              };
            },
            async set(data) {
              if (broken) throw new Error("Firestore indisponível (simulado)");
              doc = JSON.parse(JSON.stringify(data));
            },
          };
        },
      };
    },
  };
}

const firestoreBackend = makeMockFirestore(); // "a nuvem", uma instância só, compartilhada entre os dispositivos

function makeFirebaseGlobal() {
  return {
    apps: [],
    initializeApp(cfg) {
      const app = { cfg };
      this.apps.push(app);
      return app;
    },
    firestore() {
      return firestoreBackend;
    },
  };
}

// ---------- localStorage simulado (um por "dispositivo") ----------

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

// ---------- monta um "dispositivo": um contexto vm isolado com o app real carregado ----------

const realFirebaseConfigSrc = read("js/firebase-config.js");

// Extrai as credenciais já coladas em js/firebase-config.js (se houver),
// para usar exatamente esse projectId/apiKey na fase de "ligar o
// Firebase". Se o arquivo ainda estiver com os placeholders de fábrica,
// usa valores fictícios só para o teste.
const realApiKeyMatch = realFirebaseConfigSrc.match(/apiKey:\s*"([^"]+)"/);
const realProjectIdMatch = realFirebaseConfigSrc.match(/projectId:\s*"([^"]+)"/);
const REAL_API_KEY = realApiKeyMatch && !realApiKeyMatch[1].startsWith("SUA_") ? realApiKeyMatch[1] : "AIzaTestFAKE1234567890";
const REAL_PROJECT_ID = realProjectIdMatch && !realProjectIdMatch[1].startsWith("SEU_") ? realProjectIdMatch[1] : "fintech-teste";
console.log(`Credenciais usadas na fase de 'ligar o Firebase' -> projectId: ${REAL_PROJECT_ID}, apiKey: ${REAL_API_KEY.slice(0, 6)}…`);

// Para simular fielmente "o usuário usava o app ANTES de configurar o
// Firebase", o bundle usado nos dispositivos começa com um
// firebase-config.js em estado NÃO configurado (placeholders) — depois,
// no meio do teste, "ativamos" o Firebase com as credenciais extraídas
// acima, assim como aconteceria ao editar o arquivo de verdade.
const placeholderFirebaseConfigSrc = realFirebaseConfigSrc
  .replace(/apiKey:\s*"[^"]+"/, 'apiKey: "SUA_API_KEY"')
  .replace(/projectId:\s*"[^"]+"/, 'projectId: "SEU_PROJETO"');

const appBundleSrc = [placeholderFirebaseConfigSrc, read("js/plans.js"), read("js/db.js"), read("js/crypto-utils.js"), read("js/oauth.js"), read("js/api.js")].join(
  "\n;\n"
);

function buildDevice(label) {
  const localStorage = makeLocalStorage();
  const sandbox = {
    console,
    crypto: globalThis.crypto,
    TextEncoder,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
    localStorage,
    window: { addEventListener() {} },
    setTimeout,
    clearTimeout,
    Promise,
    fetch: undefined, // simula db.json inacessível aqui (não é o foco do teste)
    firebase: makeFirebaseGlobal(),
  };
  vm.createContext(sandbox);
  vm.runInContext(appBundleSrc, sandbox, { filename: `${label}.js` });
  return { label, ctx: sandbox, localStorage };
}

function run(device, code) {
  return vm.runInContext(`(async () => { ${code} })()`, device.ctx, { filename: `${device.label}-step.js` });
}

function turnOnFirebase(device) {
  return run(
    device,
    `Object.assign(FIREBASE_CONFIG, { apiKey: ${JSON.stringify(REAL_API_KEY)}, projectId: ${JSON.stringify(REAL_PROJECT_ID)} }); return {};`
  );
}

// ---------- asserts ----------

const results = [];
function check(name, cond) {
  results.push({ name, ok: !!cond });
  console.log((cond ? "OK  " : "FAIL") + " - " + name);
}

(async () => {
  console.log("\n=== FASE 1: dispositivo 1 usa o app ANTES do Firebase estar configurado ===");
  const dev1 = buildDevice("dispositivo-1");

  const signupResult = await run(
    dev1,
    `
    const signup = await Api.signup({
      company_name: "Empresa Teste",
      admin_name: "Felipe Teste",
      email: "felipe.teste@example.com",
      password: "senha-forte-123",
    });
    Auth.setToken(signup.token);
    await Api.addCategory("Mercado");
    const categories = await Api.listCategories();
    await Api.addExpense({ amount: 50.25, date: "2026-08-01", description: "Compras", category_id: categories[0].id });
    return { ok: true };
  `
  );
  check("signup + despesa funcionam normalmente sem Firebase configurado", signupResult.ok);
  check("dados foram gravados no localStorage do dispositivo 1", dev1.localStorage.getItem("fintech_saas_db_v1") !== null);
  check("Firestore (nuvem) continua vazio nesse momento", firestoreBackend._getRaw() === null);

  console.log("\n=== FASE 2: 'liga-se' o Firebase e recarrega o app ===");
  await turnOnFirebase(dev1);
  await run(dev1, `await Api.me(); return {};`); // equivalente a recarregar a página (dashboard.js chama Api.me() no load)

  const raw = firestoreBackend._getRaw();
  check("loadDb() migrou automaticamente os dados do localStorage para o Firestore", !!raw && raw.tenants.length === 1);
  check("tenant migrado bate com o criado no dispositivo 1", raw && raw.tenants[0].name === "Empresa Teste");
  check(
    "despesa lançada ANTES do Firebase existir também foi migrada",
    raw && raw.expenses.length === 1 && raw.expenses[0].amount === 50.25
  );

  console.log("\n=== FASE 3: dispositivo 2 (navegador/computador diferente, localStorage vazio) ===");
  const dev2 = buildDevice("dispositivo-2");
  await turnOnFirebase(dev2);

  const loginResult = await run(
    dev2,
    `
    const login = await Api.login({ email: "felipe.teste@example.com", password: "senha-forte-123" });
    Auth.setToken(login.token);
    const expenses = await Api.listExpenses();
    return { hasToken: !!login.token, expenses };
  `
  );
  check("login funciona no dispositivo 2 sem NUNCA ter usado esse navegador antes", loginResult.hasToken);
  check(
    "a despesa lançada no dispositivo 1 aparece no dispositivo 2 (sincronização real via Firestore)",
    loginResult.expenses.length === 1 && loginResult.expenses[0].amount === 50.25
  );

  console.log("\n=== FASE 4: dispositivo 2 lança uma nova despesa (Uber) ===");
  await run(
    dev2,
    `
    const categories = await Api.listCategories();
    await Api.addExpense({ amount: 12.9, date: "2026-08-02", description: "Uber", category_id: categories[0].id });
    // saveDb() agora sincroniza com o Firestore em segundo plano (não bloqueia
    // a UI); para testar o resultado da sincronização, esperamos a fila
    // esvaziar explicitamente (uso normal do app não precisa disso).
    await waitForPendingFirestoreWrites();
    return {};
  `
  );
  check("nova despesa do dispositivo 2 chega ao Firestore (nuvem)", firestoreBackend._getRaw().expenses.length === 2);

  console.log("\n=== FASE 5: Firebase cai (offline); dispositivo 1 lança uma despesa sem saber do Uber do dispositivo 2 ===");
  firestoreBackend._setBroken(true);
  await run(
    dev1,
    `
    const categories = await Api.listCategories();
    await Api.addExpense({ amount: 30, date: "2026-08-03", description: "Farmácia (offline)", category_id: categories[0].id });
    return {};
  `
  );
  const localDbAfterOffline = JSON.parse(dev1.localStorage.getItem("fintech_saas_db_v1"));
  const pendingFlag1 = dev1.localStorage.getItem("fintech_saas_pending_sync_v1");
  check(
    "gravação continua funcionando mesmo com o Firebase fora do ar (fallback localStorage)",
    localDbAfterOffline.expenses.length === 2 // Compras + Farmácia (dispositivo 1 nunca soube do Uber, que só existe no Firestore)
  );
  check("a mudança feita offline ainda NÃO chegou ao Firestore", firestoreBackend._getRaw().expenses.length === 2);
  check("a gravação ficou marcada como pendente de sincronização", pendingFlag1 === "1");

  console.log("\n=== FASE 6: Firebase volta a funcionar; reconciliação automática (merge de 3 vias) ===");
  firestoreBackend._setBroken(false);
  await run(dev1, `await Api.me(); return {};`); // qualquer chamada que passe por loadDb() tenta sincronizar o pendente
  const pendingFlag2 = dev1.localStorage.getItem("fintech_saas_pending_sync_v1");
  const rawAfterSync = firestoreBackend._getRaw();
  const descriptions = (rawAfterSync.expenses || []).map((e) => e.description).sort();
  check("despesa feita offline (Farmácia) foi sincronizada automaticamente ao voltar a conexão", descriptions.includes("Farmácia (offline)"));
  check(
    "a despesa do OUTRO dispositivo (Uber) NÃO foi perdida/sobrescrita pela reconciliação (é o que o merge de 3 vias evita)",
    descriptions.includes("Uber")
  );
  check("as 3 despesas de ambos os dispositivos convivem no Firestore após a reconciliação", rawAfterSync.expenses.length === 3);
  check("a flag de pendência foi limpa depois de sincronizar", pendingFlag2 === null);

  console.log("\n=== FASE 7: dispositivo 2 recarrega e enxerga o estado final e consistente ===");
  const finalDev2 = await run(dev2, `const expenses = await Api.listExpenses(); return { count: expenses.length };`);
  check("dispositivo 2 também vê as 3 despesas após a reconciliação (convergência)", finalDev2.count === 3);

  console.log("\n=== RESUMO ===");
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} verificações passaram.`);
  if (failed.length) {
    console.log(
      "Falharam:",
      failed.map((f) => f.name)
    );
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
})().catch((e) => {
  console.error("ERRO NO TESTE:", e);
  process.exitCode = 1;
});
