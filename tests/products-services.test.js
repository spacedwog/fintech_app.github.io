// ===============================
// tests/products-services.test.js
//
// Teste de integração (Node, sem dependências) da modelagem de Produtos e
// Serviços em js/api.js:
// - expõe o software sob o CNAE 6201-5/01
// - cobra serviços adicionais apenas no plano Free
// - mostra o valor atual pago para usar o sistema
//
// Como rodar:
//   node tests/products-services.test.js
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
  return { label, ctx: sandbox };
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
  const dev = buildDevice("produtos-servicos");

  const freePortfolio = await run(
    dev,
    `
    const signup = await Api.signup({
      company_name: "Conta Serviços",
      admin_name: "Cliente Serviços",
      email: "cliente.servicos@example.com",
      password: "senha-forte-123",
    });
    Auth.setToken(signup.token);
    const session = Auth.requireSession();
    const db = await loadDb();
    const tenantId = session.tenant_id;
    db.categoryBudgets.push({ id: "cb-1", tenant_id: tenantId, category_id: db.categories[0].id, month: "2026-09", previsto: 500 });
    db.mercado_pago_status = {
      global: {},
      [tenantId]: {
        last_expenses_api: { at: "2026-09-12T10:00:00.000Z" },
      },
    };
    db.openFinanceCards = [{ id: "card-1", tenant_id: tenantId, brand: "visa", holder_name: "Cliente", status: "active", credit_limit: 3000, available_limit: 2200 }];
    db.openFinanceCardTransactions = [{ id: "tx-1", tenant_id: tenantId, amount: 42, direction: "debit", status: "posted", description: "Compra", merchant_name: "Marketplace", posted_at: "2026-09-12T09:00:00.000Z" }];
    db.mercado_pago_oauth_data = {
      [tenantId]: {
        at: "2026-09-12T11:00:00.000Z",
        payments_count: 1,
        charges_count: 1,
        movements_count: 1,
        balance: { available_balance: 100, currency_id: "BRL" },
      }
    };
    await saveDb(db);
    const companyProfile = await Api.getCompanyProfile();
    const customerProfile = await Api.getCustomerProfile("2026-09");
    return buildProductsAndServicesPortfolio({ companyProfile, customerProfile, planKey: "free" });
  `
  );

  check("produto herda o CNAE 6201-5/01", freePortfolio.products[0] && String(freePortfolio.products[0].cnae || "").includes("6201-5/01"));
  check("catálogo expõe quatro serviços pagos", Array.isArray(freePortfolio.services) && freePortfolio.services.length === 4);
  check("plano Free cobra os serviços ativos", freePortfolio.billing && freePortfolio.billing.services_amount_month === 57.6);
  check("plano Free mostra o total pago igual ao plano + serviços", freePortfolio.billing && freePortfolio.billing.total_amount_month === 57.6);
  check("OAuth e ERP permanecem ativos para o uso do sistema", freePortfolio.services.filter((service) => service.active).length >= 2);
  check("Marketplace fica ativo quando há sinais da integração", freePortfolio.services.some((service) => service.id === "marketplace-hub" && service.active === true && service.current_charge_month === 12.9));

  const premiumPortfolio = await run(
    dev,
    `
    const db = await loadDb();
    db.tenants[0].plan = "premium";
    await saveDb(db);
    const companyProfile = await Api.getCompanyProfile();
    const customerProfile = await Api.getCustomerProfile("2026-09");
    return buildProductsAndServicesPortfolio({ companyProfile, customerProfile, planKey: "premium" });
  `
  );

  check("Premium mantém a mensalidade base do plano", premiumPortfolio.billing && premiumPortfolio.billing.plan_amount_month === 19.99);
  check("Premium inclui os serviços sem cobrança extra", premiumPortfolio.billing && premiumPortfolio.billing.services_amount_month === 0);
  check("Premium mostra o total pago pelo sistema sem adicionais", premiumPortfolio.billing && premiumPortfolio.billing.total_amount_month === 19.99);
  check("serviços Premium exibem status de inclusão", premiumPortfolio.services.every((service) => service.active ? service.status_label === "Incluído no Premium" || service.status_label === "Disponível sob demanda" : true));

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error("\\nFalharam " + failed.length + " verificação(ões).");
    process.exit(1);
  }

  console.log("\\nTodas as verificações passaram.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
