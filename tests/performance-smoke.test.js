// ===============================
// tests/performance-smoke.test.js
//
// Smoke test de performance local para apoiar ISO/IEC 25010.
// Executa operações reais do bundle em memória (sem rede/Firebase)
// e valida apenas limites amplos para detectar regressões grosseiras.
//
// Como rodar:
//   node tests/performance-smoke.test.js
// ===============================

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { performance } = require("perf_hooks");

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

const placeholderFirebaseConfigSrc = read("js/firebase-config.js")
  .replace(/apiKey:\s*"[^"]+"/, 'apiKey: "SUA_API_KEY"')
  .replace(/projectId:\s*"[^"]+"/, 'projectId: "SEU_PROJETO"');

const appBundleSrc = [placeholderFirebaseConfigSrc, read("js/plans.js"), read("js/db.js"), read("js/crypto-utils.js"), read("js/oauth.js"), read("js/api.js")].join(
  "\n;\n"
);

function buildDevice() {
  const sandbox = {
    console,
    crypto: globalThis.crypto,
    TextEncoder,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
    localStorage: makeLocalStorage(),
    window: { addEventListener() {} },
    setTimeout,
    clearTimeout,
    Promise,
    fetch: undefined,
    firebase: undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(appBundleSrc, sandbox, { filename: "performance-device.js" });
  return sandbox;
}

function run(ctx, code) {
  return vm.runInContext(`(async () => { ${code} })()`, ctx, { filename: "performance-step.js" });
}

function assertWithin(name, value, limitMs) {
  if (value > limitMs) {
    throw new Error(`${name} excedeu limite: ${value.toFixed(1)}ms > ${limitMs}ms`);
  }
  console.log(`OK  - ${name}: ${value.toFixed(1)}ms (limite ${limitMs}ms)`);
}

(async () => {
  const ctx = buildDevice();

  let t0 = performance.now();
  await run(
    ctx,
    `
      const signup = await Api.signup({
        company_name: "Empresa Perf",
        admin_name: "Perf Admin",
        email: "perf@example.com",
        password: "senha-forte-123"
      });
      Auth.setToken(signup.token);
      return {};
    `
  );
  let t1 = performance.now();
  assertWithin("signup + login", t1 - t0, 3000);

  t0 = performance.now();
  await run(
    ctx,
    `
      const categories = await Api.listCategories();
      const categoryId = categories[0].id;
      for (let i = 0; i < 500; i++) {
        await Api.addExpense({
          amount: 10 + (i % 5),
          date: "2026-08-15",
          description: "Lote #" + i,
          category_id: categoryId,
        });
      }
      return {};
    `
  );
  t1 = performance.now();
  assertWithin("inserção de 500 despesas", t1 - t0, 12000);

  t0 = performance.now();
  await run(
    ctx,
    `
      await Api.importCategoryBudgets({
        month: "2026-08",
        rows: [
          { categoria: "Alimentação", previsto: 1000 },
          { categoria: "Transporte", previsto: 400 },
          { categoria: "Moradia", previsto: 1500 }
        ]
      });
      const overview = await Api.getBudgetOverview("2026-08");
      if (!overview || !Array.isArray(overview.rows)) throw new Error("overview inválido");
      return {};
    `
  );
  t1 = performance.now();
  assertWithin("cálculo de visão de orçamento", t1 - t0, 3000);

  console.log("\nTeste de performance smoke finalizado com sucesso.");
})().catch((err) => {
  console.error("Falha no teste de performance smoke:", err);
  process.exit(1);
});
