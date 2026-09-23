// ===============================
// tests/customer-profile.test.js
//
// Teste de integração (Node, sem dependências) do perfil consolidado do
// cliente em js/api.js:
// - agrega métricas do ERP local (orçamento, despesas, pagamentos, auditoria)
// - expõe dados ETL de Mercado Pago/Open Finance/OAuth no mesmo payload
//
// Como rodar:
//   node tests/customer-profile.test.js
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

function buildDevice(label, options = {}) {
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
    fetch: options.fetch,
    firebase: undefined,
    __FINTECH_API_BASE__: options.apiBase || "",
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
  const dev = buildDevice("perfil-cliente");

  const profile = await run(
    dev,
    `
    const signup = await Api.signup({
      company_name: "Conta Perfil",
      admin_name: "Cliente Perfil",
      email: "cliente.perfil@example.com",
      password: "senha-forte-123",
    });
    Auth.setToken(signup.token);

    const session = Auth.requireSession();
    const db = await loadDb();
    const tenantId = session.tenant_id;
    const userId = session.user_id;
    const [mercado, moradia] = db.categories;

    db.tenants[0].plan = "premium";
    db.categoryBudgets.push(
      { id: "cb-1", tenant_id: tenantId, category_id: mercado.id, month: "2026-09", previsto: 1000 },
      { id: "cb-2", tenant_id: tenantId, category_id: moradia.id, month: "2026-09", previsto: 500 }
    );
    db.budgetGroups = [{ id: "bg-1", tenant_id: tenantId, name: "Essenciais", budget_category_id: mercado.id, expense_category_id: moradia.id, created_at: "2026-09-01T09:00:00.000Z" }];
    db.expenseRules = [{ id: "rule-1", tenant_id: tenantId, category_id: mercado.id, keyword: "uber", keyword_normalized: "uber", match_type: "contains", created_at: "2026-09-02T10:00:00.000Z" }];
    db.expenses.push(
      {
        id: "exp-1",
        tenant_id: tenantId,
        user_id: userId,
        category_id: mercado.id,
        amount: 123.45,
        date: "2026-09-10",
        description: "Uber Mercado Pago",
        generated_by_mercado_pago: true,
        mercadoPagoPaymentId: "mp-1",
      },
      {
        id: "exp-2",
        tenant_id: tenantId,
        user_id: userId,
        category_id: moradia.id,
        amount: 80,
        date: "2026-09-11",
        description: "Conta de luz",
      }
    );
    db.payments.push(
      {
        id: "pay-1",
        tenant_id: tenantId,
        user_id: userId,
        type: "pix",
        amount: 200,
        date: "2026-09-12",
        verifiedByMercadoPago: true,
      }
    );
    db.auditEvents = [
      { id: "ae-1", tenant_id: tenantId, user_id: userId, action: "payment.created", entity: "payment", message: "Pagamento", metadata: {}, created_at: "2026-09-12T13:00:00.000Z" }
    ];
    db.mercado_pago_status = {
      global: {
        last_reconcile: { verificados: 2, ambiguos: 1, sem_correspondencia: 0, at: "2026-09-12T14:00:00.000Z" }
      }
    };
    db.mercado_pago_status[tenantId] = {
      last_expenses_api: {
        criadas: 1,
        categorias_novas: 0,
        ignoradas_verificacao: 1,
        verificacoes_rejeitadas: [{ reason: "Transação rejeitada", at: "2026-09-12T12:00:00.000Z" }],
        at: "2026-09-12T12:30:00.000Z"
      },
      last_open_finance_sync: {
        cards_created: 1,
        transactions_created: 2,
        expenses_created: 1,
        categories_created: 1,
        removed_sensitive_fields: ["cvv", "security_code"],
        at: "2026-09-12T15:00:00.000Z"
      },
      last_oauth_account_sync: {
        payments_synced_created: 2,
        payments_count: 2,
        charges_count: 1,
        movements_count: 1,
        balance_found: true,
        at: "2026-09-12T16:00:00.000Z"
      }
    };
    db.openFinanceCards = [
      {
        externalCardId: "card-1",
        tenant_id: tenantId,
        brand: "master",
        holderName: "Cliente Perfil",
        last4: "5678",
        status: "active",
        creditLimit: 5000,
        availableLimit: 4100,
      }
    ];
    db.openFinanceCardTransactions = [
      {
        externalTransactionId: "tx-1",
        tenant_id: tenantId,
        amount: 35.9,
        direction: "debit",
        status: "posted",
        description: "UBER TRIP 001",
        merchant: "Uber",
        postedAt: "2026-09-12T10:00:00.000Z",
      },
      {
        externalTransactionId: "tx-2",
        tenant_id: tenantId,
        amount: 15,
        direction: "credit",
        status: "posted",
        description: "ESTORNO",
        postedAt: "2026-09-12T11:00:00.000Z",
      }
    ];
    db.mercado_pago_oauth_data = {
      [tenantId]: {
        at: "2026-09-12T16:00:00.000Z",
        payments_count: 2,
        charges_count: 1,
        movements_count: 1,
        balance: { available_balance: 500, currency_id: "BRL" },
        charges_sample: [{ id: "ch-1", amount: 100 }],
        movements_sample: [{ id: "mv-1", amount: 12.4 }],
      }
    };

    await saveDb(db);
    return Api.getCustomerProfile("2026-09");
  `
  );

  check("Perfil retorna identificação do usuário", profile.identity && profile.identity.email === "cliente.perfil@example.com");
  check("ERP soma o orçamento do mês", profile.erp && profile.erp.monthly_budget_total === 1500);
  check("ERP soma os gastos do mês", profile.erp && profile.erp.monthly_spent_total === 203.45);
  check("ETL expõe cartão Open Finance", profile.etl && profile.etl.open_finance && profile.etl.open_finance.cards_count === 1);
  check("ETL normaliza cartão Open Finance em camelCase", profile.etl && profile.etl.open_finance && profile.etl.open_finance.cards[0] && profile.etl.open_finance.cards[0].holder_name === "Cliente Perfil");
  check(
    "ETL normaliza transação Open Finance em camelCase",
    profile.etl
      && profile.etl.open_finance
      && Array.isArray(profile.etl.open_finance.transactions_sample)
      && profile.etl.open_finance.transactions_sample.some((tx) => tx.id === "tx-1" && tx.merchant_name === "Uber")
  );
  check("ETL expõe saldo OAuth", profile.etl && profile.etl.oauth && profile.etl.oauth.balance && profile.etl.oauth.balance.available_balance === 500);
  check("ETL preserva status global de reconciliação", profile.etl && profile.etl.automation && profile.etl.automation.last_reconcile && profile.etl.automation.last_reconcile.verificados === 2);
  check("Perfil IA continua disponível", profile.ai_profile && typeof profile.ai_profile.summary === "string" && profile.ai_profile.summary.length > 0);
  check("Perfil IA incorpora sinais de ERP e ETL", profile.ai_profile && profile.ai_profile.summary.includes("ERP") && profile.ai_profile.summary.includes("ETL"));
  check("Perfil IA expõe métricas de ERP e ETL", profile.ai_profile && profile.ai_profile.metrics && profile.ai_profile.metrics.open_finance_cards_count === 1 && profile.ai_profile.metrics.oauth_available_balance === 500);

  const backendDev = buildDevice("perfil-cliente-backend", {
    apiBase: "https://api.example.com",
    fetch: async (url) => {
      if (String(url).includes("/api/v1/cloud-engine/erp-overview")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              referenceMonth: "2026-10",
              plannedBudget: 999,
              executedBudget: 444,
              remainingBudget: 555,
              paymentTotal: 333,
              paymentPaid: 111,
              paymentPending: 222,
              queuedAgents: 3,
            };
          },
        };
      }
      return {
        ok: false,
        status: 404,
        async json() {
          return { message: "not found" };
        },
      };
    },
  });

  const backendProfile = await run(
    backendDev,
    `
    Auth.setToken(JSON.stringify({
      legacy: true,
      user_id: "u1",
      tenant_id: "t1",
      name: "Cliente Backend",
      email: "backend@example.com",
      role: "admin",
      access_token: "fake",
      refresh_token: "fake",
      token_type: "Bearer",
      expires_in: 3600
    }));

    const db = await loadDb();
    db.tenants = [{ id: "t1", name: "Conta Backend", plan: "free" }];
    db.users = [{ id: "u1", tenant_id: "t1", name: "Cliente Backend", email: "backend@example.com", role: "admin", tax_document: null }];
    db.categories = [{ id: "c1", tenant_id: "t1", name: "Mercado" }];
    db.categoryBudgets = [{ id: "cb1", tenant_id: "t1", category_id: "c1", month: "2026-09", previsto: 120 }];
    db.expenses = [{ id: "e1", tenant_id: "t1", user_id: "u1", category_id: "c1", amount: 20, date: "2026-09-03" }];
    db.payments = [];
    db.auditEvents = [];
    await saveDb(db);
    return Api.getCustomerProfile("2026-09");
  `
  );

  check("Backend complementa o perfil com o resumo do Cloud Engine ERP", backendProfile.erp && backendProfile.erp.cloud_engine && backendProfile.erp.cloud_engine.planned_budget === 999);
  check("Backend preserva os agregados locais do ERP ao mesclar Cloud Engine", backendProfile.erp && backendProfile.erp.monthly_budget_total === 120);
  check("Backend usa o mês de referência retornado pelo Cloud Engine", backendProfile.erp && backendProfile.erp.cloud_engine && backendProfile.erp.cloud_engine.reference_month === "2026-10");
  check("Backend injeta dados do Cloud Engine no Perfil IA", backendProfile.ai_profile && backendProfile.ai_profile.summary.includes("Cloud Engine") && backendProfile.ai_profile.metrics && backendProfile.ai_profile.metrics.cloud_engine_remaining_budget === 555);

  const degradedProfile = await run(
    dev,
    `
    const original = Api.getMercadoPagoStatus.bind(Api);
    Api.getMercadoPagoStatus = async () => { throw new Error("offline"); };
    try {
      return await Api.getCustomerProfile("2026-09");
    } finally {
      Api.getMercadoPagoStatus = original;
    }
  `
  );

  check("Perfil consolidado continua carregando quando o status ETL falha", degradedProfile && degradedProfile.erp && degradedProfile.erp.monthly_budget_total === 1500);
  check("Falha no status ETL usa valores padrão no perfil", degradedProfile && degradedProfile.etl && degradedProfile.etl.expenses_count === 0 && degradedProfile.etl.connected === false);

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
