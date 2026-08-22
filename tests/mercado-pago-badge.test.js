// ===============================
// tests/mercado-pago-badge.test.js
//
// Teste de integração (Node, sem dependências) do badge global do Mercado
// Pago na sidebar do painel (dashboard.html #mp-status, renderizado por
// MercadoPagoStatusIndicator em js/dashboard.js a partir de
// Api.getMercadoPagoStatus() em js/api.js).
//
// O badge resume o que os agentes locais orcamento_agent/mp_expenses.py
// (despesas geradas com generatedByMercadoPago/mercadoPagoPaymentId) e
// orcamento_agent/mp_reconcile.py (pagamentos confirmados com
// verifiedByMercadoPago) já gravaram no banco (Firestore/localStorage, ver
// js/db.js) — nenhum dos dois roda no navegador nem chama a API do
// Mercado Pago diretamente daqui, então este teste simula a gravação
// desses agentes escrevendo direto no "banco" local (mesma técnica dos
// outros testes de integração desta pasta), sem chamar a API real.
//
// Cobre:
//   1) sem nenhum dado do Mercado Pago -> connected=false, contadores 0;
//   2) uma despesa normal (lançada manualmente no painel) NÃO conta como
//      Mercado Pago;
//   3) depois que "mp_expenses.py" (simulado) marca uma despesa com
//      generatedByMercadoPago + mercadoPagoPaymentId, e "mp_reconcile.py"
//      (simulado) grava um pagamento com verifiedByMercadoPago -> o resumo
//      liga (connected=true), soma o valor certo e conta os dois;
//   4) o resumo é isolado por conta (tenant) — outra conta não vê nada.
//
// Como rodar:
//   node tests/mercado-pago-badge.test.js
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

// Sem Firebase configurado (placeholders) -- este teste foca na lógica de
// agregação do badge, não na sincronização (ver firebase-sync.test.js).
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
  const dev = buildDevice("dispositivo-mp-badge");

  await run(
    dev,
    `
    const signup = await Api.signup({
      company_name: "Empresa Teste Mercado Pago",
      admin_name: "Felipe Teste",
      email: "felipe.mp@example.com",
      password: "senha-forte-123",
    });
    Auth.setToken(signup.token);
    return {};
  `
  );

  // ---------- 1) Sem nenhum dado do Mercado Pago ----------
  const statusInicial = await run(dev, `return await Api.getMercadoPagoStatus();`);
  check("sem dados do Mercado Pago -> connected=false", statusInicial.connected === false);
  check("sem dados do Mercado Pago -> expenses_count=0", statusInicial.expenses_count === 0);
  check("sem dados do Mercado Pago -> payments_verified_count=0", statusInicial.payments_verified_count === 0);
  check("sem dados do Mercado Pago -> last_sync_date=null", statusInicial.last_sync_date === null);

  // ---------- 2) Despesa lançada manualmente não conta como Mercado Pago ----------
  const statusComDespesaManual = await run(
    dev,
    `
    const categories = await Api.listCategories();
    await Api.addExpense({
      amount: 120,
      date: "2026-08-01",
      description: "Mercado (lançada à mão)",
      category_id: categories[0].id,
    });
    return await Api.getMercadoPagoStatus();
  `
  );
  check("despesa lançada manualmente não vira Mercado Pago", statusComDespesaManual.connected === false && statusComDespesaManual.expenses_count === 0);

  // ---------- 3) mp_expenses.py + mp_reconcile.py (simulados) escrevendo no banco ----------
  const statusConectado = await run(
    dev,
    `
    const categories = await Api.listCategories();
    const nova = await Api.addExpense({
      amount: 89.9,
      date: "2026-08-03",
      description: "Assinatura Streaming XPTO",
      category_id: categories[0].id,
    });

    // A partir daqui, simula o que orcamento_agent/mp_expenses.py e
    // mp_reconcile.py gravam de fora do navegador: eles não passam por
    // Api.addExpense/Api.addPayment (que são endpoints do painel), escrevem
    // direto no banco (Firestore ou db.json) com os campos que o app já
    // sabe ler (ver ExpenseService.listExpenses em js/api.js).
    const db = await loadDb();
    const session = Auth.requireSession();
    const expense = db.expenses.find((e) => e.id === nova.id);
    expense.generatedByMercadoPago = true;
    expense.mercadoPagoPaymentId = "MP-PAYMENT-123";

    db.payments.push({
      id: nextId(db, "payments"),
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      type: "despesa_extra",
      plan: null,
      amount: 5,
      txid: "MP-RECONCILE-1",
      verifiedByAI: false,
      aiClassification: null,
      verifiedByMercadoPago: true,
      mercadoPagoPaymentId: "MP-PAYMENT-999",
      date: "2026-08-04T12:00:00.000Z",
    });

    // Simula também o que StatusTracker (orcamento_agent/mp_reconcile.py,
    // reaproveitado por mp_expenses.py) grava sobre a PRÓPRIA execução --
    // "global" para mp_reconcile.py (não é por tenant, ver comentário em
    // mp_reconcile.py), por tenant_id para mp_expenses.py.
    db.mercado_pago_status = {
      global: { last_reconcile: { at: "2026-08-04T12:05:00.000Z", verificados: 1, ambiguos: 0 } },
      [session.tenant_id]: {
        last_expenses_api: {
          at: "2026-08-03T09:00:00.000Z",
          criadas: 1,
          categorias_novas: 0,
          ignoradas_verificacao: 2,
          verificacoes_rejeitadas: [
            { transaction_id: "MP-9001", payment_type: "PIX", reason: "status não aprovado" },
            { transaction_id: "MP-9002", payment_type: "CARTAO", reason: "número de transação do comprovante não confere" },
          ],
        },
      },
    };
    await saveDb(db);

    return await Api.getMercadoPagoStatus();
  `
  );
  check("depois de mp_expenses.py/mp_reconcile.py -> connected=true", statusConectado.connected === true);
  check("conta só a despesa marcada como gerada via Mercado Pago (a manual da etapa 2 fica de fora)", statusConectado.expenses_count === 1);
  check("soma o valor certo da despesa via Mercado Pago (89.9)", Math.abs(statusConectado.expenses_total - 89.9) < 0.001);
  check("conta o pagamento confirmado via Mercado Pago", statusConectado.payments_verified_count === 1);
  check(
    "last_sync_date é a data mais recente entre a despesa e o pagamento (2026-08-04, do pagamento)",
    String(statusConectado.last_sync_date).slice(0, 10) === "2026-08-04"
  );
  check("automation.last_reconcile vem de mercado_pago_status.global", statusConectado.automation.last_reconcile && statusConectado.automation.last_reconcile.verificados === 1);
  check("automation.last_expenses_api vem de mercado_pago_status[tenant_id]", statusConectado.automation.last_expenses_api && statusConectado.automation.last_expenses_api.criadas === 1);
  check(
    "automation.last_expenses_api inclui motivos de rejeição da verificação",
    statusConectado.automation.last_expenses_api &&
      Array.isArray(statusConectado.automation.last_expenses_api.verificacoes_rejeitadas) &&
      statusConectado.automation.last_expenses_api.verificacoes_rejeitadas.length === 2
  );
  check("automation_configured=true quando algum agente já rodou", statusConectado.automation_configured === true);
  check("last_run_at é o horário mais recente entre os agentes (2026-08-04T12:05, do reconcile)", statusConectado.last_run_at === "2026-08-04T12:05:00.000Z");

  const profileMarketplace = await run(dev, `return await Api.getMarketplaceCustomerProfile("2026-08");`);
  check("agent IA de marketplace retorna segmento de perfil", typeof profileMarketplace.segment === "string" && profileMarketplace.segment.length > 0);
  check("agent IA de marketplace retorna resumo consolidado", typeof profileMarketplace.summary === "string" && profileMarketplace.summary.includes("Marketplace"));

  // ---------- 4) Isolado por conta: outra conta não vê nada disso ----------
  const statusOutraConta = await run(
    dev,
    `
    Auth.clearToken();
    const signup2 = await Api.signup({
      company_name: "Outra Empresa",
      admin_name: "Outro Usuário",
      email: "outro@example.com",
      password: "senha-forte-123",
    });
    Auth.setToken(signup2.token);
    return await Api.getMercadoPagoStatus();
  `
  );
  check("outra conta (tenant diferente) não vê os dados do Mercado Pago da primeira", statusOutraConta.connected === false && statusOutraConta.expenses_count === 0);
  check(
    "automation.last_expenses_api é isolado por tenant -- outra conta não vê o da primeira",
    statusOutraConta.automation.last_expenses_api === null
  );
  check(
    "automation.last_reconcile é 'global' por design (mp_reconcile.py cruza a conta inteira, não por tenant -- ver StatusTracker) -- outra conta enxerga o mesmo resumo agregado",
    statusOutraConta.automation.last_reconcile && statusOutraConta.automation.last_reconcile.verificados === 1
  );

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
