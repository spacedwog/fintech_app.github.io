// ===============================
// tests/budget-flow.test.js
//
// Teste de integração (Node, sem dependências) do fluxo unificado
// "Orçamento & Despesas" (Página 1 Importar Orçamento -> Página 2
// Registrar Despesas -> Página 3 Alertas/Orçamento) introduzido em
// js/api.js (importCategoryBudgets/getBudgetOverview) e js/db.js
// (coleção categoryBudgets). Executa o CÓDIGO REAL do projeto (mesmo
// bundle usado por tests/firebase-sync.test.js), sem Firebase — só
// localStorage — porque o que este teste cobre é a lógica de negócio do
// fluxo, não a sincronização em si (já coberta no outro teste).
//
// Cobre:
//   1) importar um "orçamento" (linhas categoria+previsto) cria as
//      categorias que não existem e grava o Previsto por categoria/mês;
//   2) despesas reais registradas na mesma categoria/mês se tornam o
//      Realizado em getBudgetOverview (não o Realizado da planilha);
//   3) categoria com despesa mas sem Previsto aparece como SEM_ORCAMENTO,
//      em vez de um falso "dentro do orçamento";
//   4) categoria com Previsto e Realizado além dele fica ESTOURADO;
//   5) reimportar o mesmo orçamento (mesmo mês) atualiza o Previsto em vez
//      de duplicar a categoria ou o registro de orçamento.
//   6) orçamento por categoria pode ser alterado/excluído e grupos automáticos
//      são criados quando categorias de despesa se assemelham ao orçamento.
//
// Como rodar:
//   node tests/budget-flow.test.js
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
// negócio do fluxo de orçamento, não na sincronização (ver firebase-sync.test.js).
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
  const dev = buildDevice("dispositivo-orcamento");

  await run(
    dev,
    `
    const signup = await Api.signup({
      company_name: "Empresa Teste Orçamento",
      admin_name: "Felipe Teste",
      email: "felipe.orcamento@example.com",
      password: "senha-forte-123",
    });
    Auth.setToken(signup.token);
    return {};
  `
  );

  // ---------- 1) Importar orçamento grava Previsto sem criar categorias ----------
  const importResult = await run(
    dev,
    `
    const result = await Api.importCategoryBudgets({
      month: "2026-08",
      rows: [
        { categoria: "Alimentação", previsto: 800 },
        { categoria: "Transporte", previsto: 200 },
        { categoria: "Categoria Nova Da Planilha", previsto: 150 },
      ],
    });
    const categories = await Api.listCategories();
    return { result, categories };
  `
  );
  check("importCategoryBudgets aplicou as 3 categorias", importResult.result.categories_count === 3);
  check(
    "não cria categorias novas a partir do orçamento importado",
    importResult.result.created_categories === 0
  );
  check(
    "a categoria nova da planilha não é criada na base de categorias do app",
    !importResult.categories.some((c) => c.name === "Categoria Nova Da Planilha")
  );

  // ---------- 2) Despesa real se torna o Realizado (não o da planilha) ----------
  const overviewAfterExpense = await run(
    dev,
    `
    const categories = await Api.listCategories();
    const alimentacao = categories.find((c) => c.name === "Alimentação");
    await Api.addExpense({ amount: 300, date: "2026-08-05", description: "Supermercado", category_id: alimentacao.id });
    await Api.addExpense({ amount: 250, date: "2026-08-10", description: "Padaria", category_id: alimentacao.id });
    const overview = await Api.getBudgetOverview("2026-08");
    return { overview, alimentacaoId: alimentacao.id };
  `
  );
  const alimentacaoRow = overviewAfterExpense.overview.rows.find((r) => r.category_name === "Alimentação");
  check("Realizado de Alimentação é a soma das despesas reais (300+250=550), não o Realizado da planilha", alimentacaoRow.realizado === 550);
  check("Previsto de Alimentação continua o importado (800)", alimentacaoRow.previsto === 800);
  check("Alimentação está DENTRO_DO_ORCAMENTO (550 <= 800)", alimentacaoRow.status === "DENTRO_DO_ORCAMENTO");

  // ---------- 3) Categoria com despesa mas SEM Previsto -> SEM_ORCAMENTO ----------
  const overviewSemOrcamento = await run(
    dev,
    `
    await Api.addCategory("Categoria Sem Orçamento");
    const categories = await Api.listCategories();
    const semOrc = categories.find((c) => c.name === "Categoria Sem Orçamento");
    await Api.addExpense({ amount: 40, date: "2026-08-12", description: "Gasto qualquer", category_id: semOrc.id });
    const overview = await Api.getBudgetOverview("2026-08");
    return { overview };
  `
  );
  const semOrcRow = overviewSemOrcamento.overview.rows.find((r) => r.category_name === "Categoria Sem Orçamento");
  check(
    "categoria com despesa mas sem Previsto importado fica SEM_ORCAMENTO (não finge estar dentro do orçamento)",
    !!semOrcRow && semOrcRow.status === "SEM_ORCAMENTO" && semOrcRow.previsto === 0 && semOrcRow.realizado === 40
  );

  // ---------- 4) Categoria estourada ----------
  const overviewEstourado = await run(
    dev,
    `
    const categories = await Api.listCategories();
    const transporte = categories.find((c) => c.name === "Transporte");
    await Api.addExpense({ amount: 250, date: "2026-08-15", description: "Uber", category_id: transporte.id });
    const overview = await Api.getBudgetOverview("2026-08");
    return { overview };
  `
  );
  const transporteRow = overviewEstourado.overview.rows.find((r) => r.category_name === "Transporte");
  check("Transporte estourou (250 gasto > 200 previsto) -> ESTOURADO", transporteRow.status === "ESTOURADO" && transporteRow.saldo === -50);
  check("getBudgetOverview reporta overBudget=true quando há ao menos 1 categoria estourada", overviewEstourado.overview.overBudget === true);

  // ---------- 5) Reimportar o mesmo mês atualiza em vez de duplicar ----------
  const reimportResult = await run(
    dev,
    `
    await Api.importCategoryBudgets({ month: "2026-08", rows: [{ categoria: "Transporte", previsto: 500 }] });
    const categories = await Api.listCategories();
    const budgets = await Api.listCategoryBudgets("2026-08");
    const transporteBudgets = budgets.filter((b) => b.category_name === "Transporte");
    const transporteCategorias = categories.filter((c) => c.name === "Transporte");
    const overview = await Api.getBudgetOverview("2026-08");
    return { transporteBudgets, transporteCategorias, overview };
  `
  );
  check("reimportar não duplica a categoria Transporte", reimportResult.transporteCategorias.length === 1);
  check("reimportar não duplica o registro de orçamento de Transporte (atualiza no lugar)", reimportResult.transporteBudgets.length === 1);
  check("Previsto de Transporte foi atualizado para 500", reimportResult.transporteBudgets[0].previsto === 500);
  const transporteRow2 = reimportResult.overview.rows.find((r) => r.category_name === "Transporte");
  check("depois de reimportar com Previsto maior, Transporte volta a ficar DENTRO_DO_ORCAMENTO (250 <= 500)", transporteRow2.status === "DENTRO_DO_ORCAMENTO");

  // ---------- 6) alteração/deleção de orçamento por categoria + grupos ----------
  const manageBudgets = await run(
    dev,
    `
    const before = await Api.listCategoryBudgets("2026-08");
    const transporte = before.find((b) => b.category_name === "Transporte");
    await Api.setCategoryBudget({ category_id: transporte.category_id, month: "2026-08", previsto: 333 });
    const afterSet = await Api.listCategoryBudgets("2026-08");
    const groups = await Api.listBudgetGroups();
    const transporteUpdated = afterSet.find((b) => b.category_name === "Transporte");
    await Api.deleteCategoryBudget(transporteUpdated.id);
    const afterDelete = await Api.listCategoryBudgets("2026-08");
    return { transporteUpdated, afterDelete, groups };
  `
  );
  check("setCategoryBudget permite alterar orçamento por categoria existente", manageBudgets.transporteUpdated.previsto === 333);
  check("listBudgetGroups cria grupos automáticos para categorias semelhantes", manageBudgets.groups.length > 0);
  check(
    "deleteCategoryBudget remove orçamento por categoria",
    !manageBudgets.afterDelete.some((b) => b.category_name === "Transporte")
  );

  // ---------- normalização legada Mercado Pago ----------
  const legadoMercadoPago = await run(
    dev,
    `
    await Api.addCategory("Mercado Pago (não categorizado)");
    await Api.setCategoryBudget({ month: "2026-08", previsto: 99, category_name: "Mercado Pago (não categorizado)" });
    const categories = await Api.listCategories();
    const budgets = await Api.listCategoryBudgets("2026-08");
    return { categories, budgets };
  `
  );
  check(
    "normaliza categoria legada Mercado Pago (não categorizado) para Mercado Pago",
    !legadoMercadoPago.categories.some((c) => c.name === "Mercado Pago (não categorizado)")
      && legadoMercadoPago.categories.some((c) => c.name === "Mercado Pago")
  );
  check(
    "normaliza orçamento com categoria legada Mercado Pago (não categorizado)",
    !legadoMercadoPago.budgets.some((b) => b.category_name === "Mercado Pago (não categorizado)")
      && legadoMercadoPago.budgets.some((b) => b.category_name === "Mercado Pago")
  );

  // ---------- mês sem nenhum orçamento importado ----------
  const overviewMesVazio = await run(dev, `const overview = await Api.getBudgetOverview("2099-01"); return { overview };`);
  check("mês sem nenhum orçamento nem despesa -> hasAnyBudget=false e rows vazio", overviewMesVazio.overview.hasAnyBudget === false && overviewMesVazio.overview.rows.length === 0);

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
