// ===============================
// tests/firebase-sync.test.js
//
// Teste de compatibilidade após a remoção do Firestore:
//   1) confirma que a camada legada de Firebase não abre conexão;
//   2) garante fallback automático para a API local quando o backend Java
//      está indisponível;
//   3) valida persistência segura em localStorage nesse cenário.
//
// Como rodar:
//   node tests/firebase-sync.test.js
// ===============================

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

const appBundleSrc = [read("js/firebase-config.js"), read("js/plans.js"), read("js/db.js"), read("js/crypto-utils.js"), read("js/oauth.js"), read("js/api.js")].join(
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
    window: {
      addEventListener() {},
      location: { protocol: "https:", origin: "https://app.example.com" },
    },
    setTimeout,
    clearTimeout,
    Promise,
    fetch: async () => ({
      ok: false,
      status: 503,
      async json() {
        return { message: "Backend indisponível" };
      },
    }),
    firebase: undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(appBundleSrc, sandbox, { filename: `${label}.js` });
  return { label, ctx: sandbox, localStorage };
}

function buildDeviceWithStatus(label, status, message) {
  const localStorage = makeLocalStorage();
  const sandbox = {
    console,
    crypto: globalThis.crypto,
    TextEncoder,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
    localStorage,
    window: {
      addEventListener() {},
      location: { protocol: "https:", origin: "https://app.example.com" },
    },
    setTimeout,
    clearTimeout,
    Promise,
    fetch: async () => ({
      ok: false,
      status,
      async json() {
        return { message };
      },
    }),
    firebase: undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(appBundleSrc, sandbox, { filename: `${label}.js` });
  return { label, ctx: sandbox, localStorage };
}

function run(device, code) {
  return vm.runInContext(`(async () => { ${code} })()`, device.ctx, { filename: `${device.label}-step.js` });
}

const results = [];
function check(name, cond) {
  results.push({ name, ok: !!cond });
  console.log((cond ? "OK  " : "FAIL") + " - " + name);
}

(async () => {
  const dev = buildDevice("dispositivo-local");

  const compatibility = await run(
    dev,
    `
      return {
        firebaseConfigured: isFirebaseConfigured(),
        firestore: getFirestore(),
        firestoreDocRef: getFirestoreDocRef(),
        initialStatus: Api.getStorageStatus(),
      };
    `
  );

  check("integração legada reporta Firebase desativado", compatibility.firebaseConfigured === false);
  check("nenhuma instância Firestore é exposta", compatibility.firestore === null && compatibility.firestoreDocRef === null);
  check("antes da primeira falha, o app tenta usar o backend Java", compatibility.initialStatus.state === "server");

  const signup = await run(
    dev,
    `
      const signup = await Api.signup({
        company_name: "Empresa Local",
        admin_name: "Admin Local",
        email: "local@example.com",
        password: "senha-forte-123",
      });
      Auth.setToken(signup.token);
      const categories = await Api.listCategories();
      await Api.addExpense({
        amount: 42.5,
        date: "2026-09-23",
        description: "Despesa local",
        category_id: categories[0].id,
      });
      await waitForPendingFirestoreWrites();
      return {
        token: signup.token,
        categories: categories.length,
        dbRaw: localStorage.getItem("fintech_saas_db_v1"),
        status: Api.getStorageStatus(),
      };
    `
  );

  const db = JSON.parse(signup.dbRaw);
  check("fallback para a API local funciona quando o backend responde 503", !!signup.token && signup.categories > 0);
  check("dados continuam persistidos no localStorage", Array.isArray(db.expenses) && db.expenses.length === 1);
  check("status muda para modo local após detectar backend indisponível", signup.status.state === "local");

  const dev405 = buildDeviceWithStatus("dispositivo-405", 405, "Erro HTTP 405");
  const signup405 = await run(
    dev405,
    `
      const signup = await Api.signup({
        company_name: "Empresa Pages",
        admin_name: "Admin Pages",
        email: "pages@example.com",
        password: "senha-forte-123",
      });
      Auth.setToken(signup.token);
      return {
        token: signup.token,
        status: Api.getStorageStatus(),
        dbRaw: localStorage.getItem("fintech_saas_db_v1"),
      };
    `
  );

  const db405 = JSON.parse(signup405.dbRaw);
  check("fallback para a API local funciona quando o backend responde 405", !!signup405.token);
  check("modo local é ativado após resposta 405 do backend estático", signup405.status.state === "local");
  check("cadastro continua persistido localmente após 405", Array.isArray(db405.users) && db405.users.length === 1);

  console.log("\n=== RESUMO ===");
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} verificações passaram.`);
  if (failed.length) {
    console.log("Falharam:", failed.map((r) => r.name).join(" | "));
    process.exit(1);
  }
})();
