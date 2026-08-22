// ===============================
// tests/plan-limits.test.js
//
// Teste de integração (Node, sem dependências) das regras de limites dos
// planos em js/plans.js + js/api.js:
// - Free: 6 despesas/dia (7ª vira extra)
// - Free: 3 importações de orçamento/dia
// - Premium: importações de orçamento ilimitadas
//
// Como rodar:
//   node tests/plan-limits.test.js
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

const placeholderFirebaseConfigSrc = read("js/firebase-config.js")
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
    fetch: undefined,
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
  const dev = buildDevice("dispositivo-limites-planos");

  await run(
    dev,
    `
    const signup = await Api.signup({
      company_name: "Empresa Teste Limites",
      admin_name: "Felipe Teste",
      email: "felipe.limites@example.com",
      password: "senha-forte-123",
    });
    Auth.setToken(signup.token);
    return {};
  `
  );

  const expenseLimit = await run(
    dev,
    `
    const categories = await Api.listCategories();
    const categoryId = categories[0].id;
    const outputs = [];
    for (let i = 1; i <= 7; i++) {
      outputs.push(
        await Api.addExpense({
          amount: 10 + i,
          date: "2026-08-20",
          description: "Despesa #" + i,
          category_id: categoryId,
        })
      );
    }
    const quota = await Api.getExpenseQuota();
    return { outputs, quota };
  `
  );

  check("Free mantém as 6 primeiras despesas do dia sem extra", expenseLimit.outputs.slice(0, 6).every((x) => x.is_extra === false));
  check("Free marca a 7ª despesa do dia como extra", expenseLimit.outputs[6].is_extra === true);
  check("Free usa limite diário de 6 despesas", expenseLimit.quota.max_per_day === 6);

  const budgetImportFree = await run(
    dev,
    `
    const ok = [];
    for (let i = 1; i <= 3; i++) {
      ok.push(
        await Api.importCategoryBudgets({
          month: "2026-08",
          rows: [{ categoria: "Categoria " + i, previsto: 100 * i }],
        })
      );
    }
    let blocked = null;
    try {
      await Api.importCategoryBudgets({
        month: "2026-08",
        rows: [{ categoria: "Categoria 4", previsto: 400 }],
      });
    } catch (err) {
      blocked = String(err.message || "");
    }
    return { okCount: ok.length, blocked };
  `
  );

  check("Free permite até 3 importações de orçamento no dia", budgetImportFree.okCount === 3);
  check(
    "Free bloqueia a 4ª importação de orçamento no dia",
    typeof budgetImportFree.blocked === "string" && budgetImportFree.blocked.includes("Limite diário de importação")
  );

  const budgetImportPremium = await run(
    dev,
    `
    Auth.clearToken();
    const signup = await Api.signup({
      company_name: "Empresa Premium",
      admin_name: "Felipe Premium",
      email: "felipersantos1988@gmail.com",
      password: "senha-forte-123",
    });
    Auth.setToken(signup.token);
    let imports = 0;
    for (let i = 1; i <= 5; i++) {
      await Api.importCategoryBudgets({
        month: "2026-09",
        rows: [{ categoria: "Premium " + i, previsto: 50 * i }],
      });
      imports++;
    }
    const me = await Api.me();
    return { imports, plan: me.tenant && me.tenant.plan };
  `
  );

  check("conta premium de override entra no plano premium", budgetImportPremium.plan === "premium");
  check("Premium importa orçamento sem limite diário (5/5)", budgetImportPremium.imports === 5);

  console.log("\n=== RESUMO ===");
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${total} verificações passaram.`);
  if (passed !== total) {
    console.log("\nFalharam:");
    results.filter((r) => !r.ok).forEach((r) => console.log("  - " + r.name));
    process.exit(1);
  }
})().catch((err) => {
  console.error("Erro inesperado no teste:", err);
  process.exit(1);
});
