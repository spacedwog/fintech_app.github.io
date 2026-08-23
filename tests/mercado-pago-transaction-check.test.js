// ===============================
// tests/mercado-pago-transaction-check.test.js
//
// Cobertura da busca de ID da transação do Mercado Pago
// (Api.verifyMercadoPagoTransactionId em js/api.js).
//
// Como rodar:
//   node tests/mercado-pago-transaction-check.test.js
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
  const dev = buildDevice("dispositivo-mp-txn-check");

  await run(
    dev,
    `
    const signup = await Api.signup({
      company_name: "Empresa Teste MP Check",
      admin_name: "Ana Teste",
      email: "ana.mp.check@example.com",
      password: "senha-forte-123",
    });
    Auth.setToken(signup.token);
    `
  );

  const naoEncontrado = await run(dev, `return await Api.verifyMercadoPagoTransactionId("MP-0000");`);
  check("retorna status not_found quando não existe nada", naoEncontrado.status === "not_found" && naoEncontrado.found === false);

  await run(
    dev,
    `
    const session = Auth.requireSession();
    const db = await loadDb();
    db.expenses.push({
      id: nextId(db, "expenses"),
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      category_id: null,
      amount: 89.9,
      date: "2026-08-20",
      description: "Compra marketplace",
      transaction_number: null,
      generatedByMercadoPago: true,
      mercadoPagoPaymentId: "MP-9001",
      created_at: "2026-08-20T10:00:00.000Z",
    });
    db.payments.push({
      id: nextId(db, "payments"),
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      type: "despesa_extra",
      plan: null,
      amount: 5,
      txid: "TX-ABC-1",
      verifiedByAI: false,
      aiClassification: null,
      verifiedByMercadoPago: true,
      mercadoPagoPaymentId: "MP-9001",
      date: "2026-08-21T12:00:00.000Z",
    });
    db.mercado_pago_status = {
      [session.tenant_id]: {
        last_expenses_api: {
          at: "2026-08-21T12:05:00.000Z",
          verificacoes_rejeitadas: [
            { transaction_id: "MP-9002", payment_type: "PIX", reason: "status não aprovado" },
          ],
        },
      },
    };
    await saveDb(db);
    `
  );

  const confirmado = await run(dev, `return await Api.verifyMercadoPagoTransactionId("MP-9001");`);
  check("status verified quando há pagamento confirmado pelo Mercado Pago", confirmado.status === "verified");
  check("encontra despesa e pagamento para o mesmo ID", confirmado.summary.expenses === 1 && confirmado.summary.payments === 1);

  const rejeitado = await run(dev, `return await Api.verifyMercadoPagoTransactionId("MP-9002");`);
  check("status rejected quando aparece em rejeições da automação", rejeitado.status === "rejected" && rejeitado.summary.rejections === 1);

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
