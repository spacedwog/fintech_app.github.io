// ===============================
// frontend/js/dashboard.js
// Lógica do painel (dashboard.html) - SPA simples com fetch
// ===============================

let CURRENT_USER = null;
let CURRENT_TENANT = null;
let monthlyChart = null;
let categoryChart = null;

// Chave Pix real da SPACECWORP (a mesma usada no site principal).
const PIX_MERCHANT = { key: "62904267000160", name: "SPACECWORP", city: "OSASCO" };

document.addEventListener("DOMContentLoaded", async () => {
  if (!Auth.isLoggedIn()) {
    window.location.href = "login.html";
    return;
  }

  try {
    const me = await Api.me();
    CURRENT_USER = me.user;
    CURRENT_TENANT = me.tenant;
  } catch (err) {
    Auth.clearToken();
    window.location.href = "login.html";
    return;
  }

  setupPixModal();
  setupBudgetLayoutModal();
  renderShell();
  bindNav();
  showView("budget-flow");

  // Indicador de status de sincronização com o Firebase (ver
  // getSyncStatus() em js/db.js): atualiza já ao carregar e depois
  // periodicamente, além de reagir a ficar online/offline na hora.
  renderSyncStatus();
  setInterval(renderSyncStatus, 5000);
  window.addEventListener("online", renderSyncStatus);
  window.addEventListener("offline", renderSyncStatus);
});

function renderShell() {
  document.getElementById("user-name").textContent = CURRENT_USER.name;
  document.getElementById("tenant-name").textContent = CURRENT_TENANT.name;
  const planBadge = document.getElementById("tenant-plan-badge");
  planBadge.textContent = CURRENT_TENANT.plan_details.label;
  planBadge.className = `badge ${CURRENT_TENANT.plan}`;

  if (CURRENT_USER.role !== "admin") {
    document.querySelectorAll("[data-admin-only]").forEach((el) => el.classList.add("hidden"));
  }

  document.getElementById("logout-btn").addEventListener("click", () => {
    Auth.clearToken();
    window.location.href = "login.html";
  });
}

// ---------- Status de sincronização (Firebase x localStorage) ----------

function renderSyncStatus() {
  const box = document.getElementById("sync-status");
  const label = document.getElementById("sync-status-label");
  if (!box || !label || typeof getSyncStatus !== "function") return;

  const status = getSyncStatus();
  box.className = `sync-status ${status.state}`;
  box.title = status.label;

  const shortLabels = {
    local: "Modo local (sem Firebase)",
    error: "Firebase com erro — modo local",
    pending: "Sincronizando…",
    synced: "Sincronizado",
  };
  label.textContent = shortLabels[status.state] || status.label;
}

function bindNav() {
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });
}

function showView(viewName) {
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(`view-${viewName}`).classList.remove("hidden");

  if (viewName === "budget-flow") loadBudgetFlowView();
  if (viewName === "reports") loadReportsView();
  if (viewName === "team") loadTeamView();
  if (viewName === "plan") loadPlanView();
}

// ---------- Orçamento & Despesas (fluxo único paginado) ----------
//
// Página 1 "Importar Orçamento" -> Página 2 "Registrar Despesas" -> Página 3
// "Alertas / Orçamento". As três mantêm sua lógica própria (mais abaixo,
// nas seções originais de cada uma) — o que fecha o ciclo entre elas é o
// Previsto por categoria persistido na Página 1 (Api.importCategoryBudgets)
// e lido de volta na Página 3 junto com as despesas reais da Página 2
// (Api.getBudgetOverview).

let flowPagerBound = false;
let currentFlowPage = 1;

function loadBudgetFlowView() {
  if (!flowPagerBound) {
    flowPagerBound = true;
    bindFlowPager();
  }
  goToFlowPage(currentFlowPage);
}

function bindFlowPager() {
  document.querySelectorAll(".flow-page-dot").forEach((btn) => {
    btn.addEventListener("click", () => goToFlowPage(parseInt(btn.dataset.flowPage, 10)));
  });
  const prevBtn = document.getElementById("flow-prev-btn");
  const nextBtn = document.getElementById("flow-next-btn");
  if (prevBtn) prevBtn.addEventListener("click", () => goToFlowPage(currentFlowPage - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => goToFlowPage(currentFlowPage + 1));
}

function goToFlowPage(page) {
  page = Math.min(3, Math.max(1, page));
  currentFlowPage = page;

  document.querySelectorAll(".flow-page").forEach((el, idx) => {
    el.classList.toggle("hidden", idx + 1 !== page);
  });
  document.querySelectorAll(".flow-page-dot").forEach((btn) => {
    btn.classList.toggle("active", parseInt(btn.dataset.flowPage, 10) === page);
  });
  const indicator = document.getElementById("flow-page-indicator");
  if (indicator) indicator.textContent = `Página ${page} de 3`;
  const prevBtn = document.getElementById("flow-prev-btn");
  const nextBtn = document.getElementById("flow-next-btn");
  if (prevBtn) prevBtn.disabled = page === 1;
  if (nextBtn) nextBtn.disabled = page === 3;

  // Cada página busca os dados mais recentes ao ser exibida: registrar uma
  // despesa na Página 2 e ir pra Página 3 já mostra o Realizado atualizado,
  // sem precisar recarregar a tela inteira.
  if (page === 1) loadBudgetView();
  if (page === 2) loadExpensesView();
  if (page === 3) {
    loadAlertsView();
    loadBudgetOverview();
  }
}

// ---------- Registrar Despesa ----------

let expenseCategorySelectBound = false;

async function loadExpensesView() {
  const categories = await Api.listCategories();
  const select = document.getElementById("expense-category");
  const previous = select.value;
  select.innerHTML = categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  if (previous && categories.some((c) => c.id === previous)) select.value = previous;

  if (!expenseCategorySelectBound) {
    expenseCategorySelectBound = true;
    select.addEventListener("change", refreshExpenseCategoryBudgetInfo);
  }

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("expense-date").value = today;

  await refreshQuotaInfo();
  await refreshExpenseTable();
  await refreshExpenseCategoryBudgetInfo();
}

// Fecha o fluxo Importar Orçamento -> Registrar Despesas: mostra, para a
// categoria selecionada no formulário, o Previsto importado na Página 1 e
// o Realizado real já gasto neste mês (incluindo a despesa que está sendo
// preenchida ainda não salva) — ver Api.getBudgetOverview.
async function refreshExpenseCategoryBudgetInfo() {
  const box = document.getElementById("expense-category-budget-info");
  const select = document.getElementById("expense-category");
  if (!box || !select || !select.value) {
    if (box) box.textContent = "";
    return;
  }

  const month = new Date().toISOString().slice(0, 7);
  try {
    const overview = await Api.getBudgetOverview(month);
    const row = overview.rows.find((r) => r.category_id === select.value);
    if (!row || row.status === "SEM_ORCAMENTO") {
      box.textContent = "Nenhum orçamento importado para esta categoria neste mês — veja a Página 1 (Importar Orçamento).";
      box.style.color = "";
      return;
    }
    const restante = row.previsto - row.realizado;
    box.style.color = row.status === "ESTOURADO" ? "#b45309" : "var(--success)";
    box.textContent =
      `Orçamento de ${row.category_name} em ${month}: R$ ${row.realizado.toFixed(2)} usados de ` +
      `R$ ${row.previsto.toFixed(2)} previstos` +
      (restante >= 0 ? ` (R$ ${restante.toFixed(2)} restantes).` : ` (R$ ${Math.abs(restante).toFixed(2)} acima do previsto).`);
  } catch (e) {
    box.textContent = "";
  }
}

async function refreshQuotaInfo() {
  const box = document.getElementById("expense-quota-info");
  if (!box) return;
  const quota = await Api.getExpenseQuota();
  if (quota.unlimited) {
    box.textContent = "Plano Premium: despesas ilimitadas.";
    box.className = "small-muted";
  } else {
    const remaining = Math.max(0, quota.max_per_day - quota.used_today);
    box.textContent =
      `Plano Free: ${quota.used_today}/${quota.max_per_day} despesas gratuitas hoje` +
      (remaining > 0
        ? ` (restam ${remaining}).`
        : ` — limite atingido. Novas despesas hoje pedirão pagamento via Pix de R$ ${quota.overage_price.toFixed(2)}/unidade.`);
    box.className = remaining > 0 ? "small-muted" : "small-muted";
  }
}

async function refreshExpenseTable() {
  const expenses = await Api.listExpenses();
  const tbody = document.getElementById("expenses-tbody");
  tbody.innerHTML = expenses
    .map(
      (e) => `
      <tr>
        <td>${e.date}</td>
        <td>${e.category_name || "-"}</td>
        <td>${e.description || ""}${e.is_extra ? ' <span class="badge premium" title="Despesa extra (fora do limite diário do plano Free)">extra</span>' : ""}</td>
        <td>R$ ${e.amount.toFixed(2)}</td>
        <td><button class="secondary" onclick="removeExpense('${e.id}')">Excluir</button></td>
      </tr>`
    )
    .join("");
}

async function removeExpense(id) {
  await Api.deleteExpense(id);
  await refreshQuotaInfo();
  await refreshExpenseTable();
  await refreshExpenseCategoryBudgetInfo();
}

document.addEventListener("submit", async (e) => {
  if (e.target && e.target.id === "expense-form") {
    e.preventDefault();
    const errorBox = document.getElementById("expense-error");
    const successBox = document.getElementById("expense-success");
    errorBox.classList.add("hidden");
    successBox.classList.add("hidden");

    const amount = parseFloat(document.getElementById("expense-amount").value);
    const date = document.getElementById("expense-date").value;
    const description = document.getElementById("expense-description").value;
    // IDs são strings (ver js/db.js) — usa o valor do <select> como está,
    // sem converter para número.
    const category_id = document.getElementById("expense-category").value;

    try {
      const quota = await Api.getExpenseQuota();
      const willBeExtra = !quota.unlimited && quota.used_today >= quota.max_per_day;

      const finalize = async (txid, analysis) => {
        const result = await Api.addExpense({ amount, date, description, category_id });
        successBox.textContent = result.is_extra
          ? `Pagamento confirmado! Despesa extra registrada (R$ ${result.extra_charge.toFixed(2)}).`
          : "Despesa registrada!";
        successBox.classList.remove("hidden");
        document.getElementById("expense-form").reset();
        document.getElementById("expense-date").value = new Date().toISOString().slice(0, 10);
        if (result.is_extra) {
          await recordPayment({
            type: "despesa_extra",
            amount: result.extra_charge,
            txid,
            verifiedByAI: !!(analysis && analysis.amountMatches && analysis.merchantMatches),
            aiClassification: analysis ? analysis.classification : null,
          });
        }
        await refreshQuotaInfo();
        await refreshExpenseTable();
        await refreshExpenseCategoryBudgetInfo();
      };

      if (willBeExtra) {
        // Limite diário do plano Free atingido: só salva a despesa depois
        // que o comprovante do Pix de R$ 5,00 for enviado e a IA (OCR
        // local) validar o pagamento — ver setupPixModal()/handleReceiptUpload().
        openPixPayment({
          amount: quota.overage_price,
          description: "Despesa extra — limite diário do plano Free",
          txidPrefix: "DESP",
          expectedType: "despesa",
          onConfirm: (txid, analysis) => finalize(txid, analysis),
        });
      } else {
        await finalize(null, null);
      }
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove("hidden");
    }
  }

  if (e.target && e.target.id === "category-form") {
    e.preventDefault();
    const name = document.getElementById("new-category-name").value.trim();
    if (!name) return;
    await Api.addCategory(name);
    document.getElementById("new-category-name").value = "";
    await loadExpensesView();
  }
});

// ---------- Resumo Mensal ----------

async function loadReportsView() {
  const monthly = await Api.monthlyReport();
  const byCategory = await Api.categoryReport();

  const ctx1 = document.getElementById("monthly-chart").getContext("2d");
  if (monthlyChart) monthlyChart.destroy();
  monthlyChart = new Chart(ctx1, {
    type: "bar",
    data: {
      labels: monthly.map((m) => m.month),
      datasets: [{ label: "Gasto (R$)", data: monthly.map((m) => m.total), backgroundColor: "#2563eb" }],
    },
    options: { responsive: true, plugins: { legend: { display: false } } },
  });

  const ctx2 = document.getElementById("category-chart").getContext("2d");
  if (categoryChart) categoryChart.destroy();
  categoryChart = new Chart(ctx2, {
    type: "doughnut",
    data: {
      labels: byCategory.map((c) => c.category),
      datasets: [{ data: byCategory.map((c) => c.total), backgroundColor: [
        "#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#6b7280",
      ] }],
    },
    options: { responsive: true },
  });
}

// ---------- Alertas / Orçamento ----------

async function loadAlertsView() {
  const alertData = await Api.getAlerts();
  const box = document.getElementById("alerts-box");
  if (alertData.over_budget) {
    box.className = "alert-warn";
    box.textContent = `⚠️ Você ultrapassou o orçamento! Gasto: R$ ${alertData.total.toFixed(2)} / Limite: R$ ${alertData.limit.toFixed(2)}`;
  } else {
    box.className = "alert-ok";
    box.textContent = `✅ Tudo sob controle. Gasto: R$ ${alertData.total.toFixed(2)} / Limite: R$ ${(alertData.limit || 0).toFixed(2)}`;
  }
}

// ---------- Previsto x Realizado por categoria (fecha o fluxo: dados
// importados na Página 1 + despesas reais registradas na Página 2) ----------

let budgetOverviewMonthBound = false;

async function loadBudgetOverview(month) {
  const monthInput = document.getElementById("budget-overview-month");
  if (!budgetOverviewMonthBound && monthInput) {
    budgetOverviewMonthBound = true;
    monthInput.addEventListener("change", () => loadBudgetOverview(monthInput.value));
  }
  if (monthInput && !monthInput.value) monthInput.value = new Date().toISOString().slice(0, 7);
  const targetMonth = month || (monthInput && monthInput.value) || new Date().toISOString().slice(0, 7);

  const emptyBox = document.getElementById("budget-overview-empty");
  const summaryBox = document.getElementById("budget-overview-summary");
  const tbody = document.getElementById("budget-overview-tbody");
  if (!summaryBox || !tbody) return;

  const overview = await Api.getBudgetOverview(targetMonth);

  if (emptyBox) emptyBox.classList.toggle("hidden", overview.hasAnyBudget);

  if (!overview.rows.length) {
    summaryBox.className = "alert-ok";
    summaryBox.textContent = "Nenhuma categoria com orçamento ou despesa neste mês ainda.";
    tbody.innerHTML = "";
    return;
  }

  summaryBox.className = overview.overBudget ? "alert-warn" : "alert-ok";
  const icon = overview.overBudget ? "⚠️" : "✅";
  summaryBox.textContent = overview.overBudget
    ? `${icon} ${overview.alerts.length} categoria(s) estouraram o orçamento deste mês. ` +
      `Previsto total: R$ ${overview.totalPrevisto.toFixed(2)} / Realizado total: R$ ${overview.totalRealizado.toFixed(2)}.`
    : `${icon} Nenhuma categoria estourou o orçamento deste mês. ` +
      `Previsto total: R$ ${overview.totalPrevisto.toFixed(2)} / Realizado total: R$ ${overview.totalRealizado.toFixed(2)} ` +
      `(saldo: R$ ${overview.saldoTotal.toFixed(2)}).`;

  const statusBadge = {
    ESTOURADO: '<span class="badge estourado">ESTOURADO</span>',
    DENTRO_DO_ORCAMENTO: '<span class="badge dentro">DENTRO DO ORÇAMENTO</span>',
    SEM_ORCAMENTO: '<span class="badge sem-orcamento" title="Nenhum orçamento importado para esta categoria neste mês">SEM ORÇAMENTO</span>',
  };

  tbody.innerHTML = overview.rows
    .map(
      (r) => `
      <tr>
        <td>${r.category_name}</td>
        <td>R$ ${r.previsto.toFixed(2)}</td>
        <td>R$ ${r.realizado.toFixed(2)}</td>
        <td>R$ ${r.saldo.toFixed(2)}</td>
        <td>${statusBadge[r.status] || ""}</td>
      </tr>`
    )
    .join("");
}

document.addEventListener("submit", async (e) => {
  if (e.target && e.target.id === "budget-form") {
    e.preventDefault();
    const limit_value = parseFloat(document.getElementById("budget-limit").value);
    const month = document.getElementById("budget-month").value;
    await Api.setBudget({ limit_value, month });
    await loadAlertsView();
  }
});

// ---------- Importar Orçamento (IA de leitura de orçamento via upload) ----------
//
// Substitui a leitura de um arquivo fixo salvo no repositório por upload
// direto no navegador: o usuário sobe qualquer planilha de orçamento e o
// js/budget-ai.js (SheetJS + heurística de cabeçalho, 100% client-side)
// identifica categorias, meses e valores Previsto/Realizado.
//
// Quando a heurística não reconhece o formato, o usuário pode montar um
// "layout de leitura" manualmente no modal "Configurar layout de leitura"
// (aba, formato, linhas/colunas exatas) e salvá-lo para reusar em uploads
// futuros — persistido via Api.saveBudgetLayout/listBudgetLayouts
// (js/api.js + js/db.js) e aplicado por BudgetAI.analyzeWithLayout.

let budgetInputBound = false;
let budgetSelectedFile = null;
let budgetLayouts = [];
let budgetLayoutModalEl = null;
let budgetEditingLayoutId = null;
let budgetLastResult = null; // último resultado lido (js/budget-ai.js), para o botão "Usar este orçamento no app"

function loadBudgetView() {
  if (!budgetInputBound) {
    budgetInputBound = true;

    const input = document.getElementById("budget-file-input");
    if (input) {
      input.addEventListener("change", () => {
        budgetSelectedFile = input.files && input.files[0];
        handleBudgetFileUpload(budgetSelectedFile);
      });
    }

    const select = document.getElementById("budget-layout-select");
    if (select) {
      select.addEventListener("change", () => {
        toggleBudgetLayoutButtons();
        if (budgetSelectedFile) handleBudgetFileUpload(budgetSelectedFile);
      });
    }

    const newBtn = document.getElementById("budget-layout-new-btn");
    if (newBtn) newBtn.addEventListener("click", () => openBudgetLayoutModal(null));

    const editBtn = document.getElementById("budget-layout-edit-btn");
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        const layout = getSelectedBudgetLayout();
        if (layout) openBudgetLayoutModal(layout);
      });
    }

    const deleteBtn = document.getElementById("budget-layout-delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        const layout = getSelectedBudgetLayout();
        if (!layout) return;
        if (!confirm(`Excluir o layout "${layout.name}"?`)) return;
        await Api.deleteBudgetLayout(layout.id);
        await refreshBudgetLayoutSelect();
      });
    }

    const adoptBtn = document.getElementById("budget-adopt-btn");
    if (adoptBtn) adoptBtn.addEventListener("click", handleBudgetAdopt);
  }

  const targetMonthInput = document.getElementById("budget-adopt-target-month");
  if (targetMonthInput && !targetMonthInput.value) {
    targetMonthInput.value = new Date().toISOString().slice(0, 7);
  }

  refreshBudgetLayoutSelect();
}

function getSelectedBudgetLayout() {
  const select = document.getElementById("budget-layout-select");
  if (!select || !select.value) return null;
  return budgetLayouts.find((l) => l.id === select.value) || null;
}

function toggleBudgetLayoutButtons() {
  const hasLayout = !!getSelectedBudgetLayout();
  const editBtn = document.getElementById("budget-layout-edit-btn");
  const deleteBtn = document.getElementById("budget-layout-delete-btn");
  if (editBtn) editBtn.classList.toggle("hidden", !hasLayout);
  if (deleteBtn) deleteBtn.classList.toggle("hidden", !hasLayout);
}

async function refreshBudgetLayoutSelect() {
  const select = document.getElementById("budget-layout-select");
  if (!select) return;
  const previous = select.value;
  budgetLayouts = await Api.listBudgetLayouts();
  select.innerHTML =
    '<option value="">Detecção automática</option>' +
    budgetLayouts.map((l) => `<option value="${l.id}">${l.name}</option>`).join("");
  if (previous && budgetLayouts.some((l) => l.id === previous)) select.value = previous;
  toggleBudgetLayoutButtons();
}

function handleBudgetFileUpload(file) {
  const status = document.getElementById("budget-import-status");
  const summaryCard = document.getElementById("budget-summary-card");
  const tableCard = document.getElementById("budget-table-card");
  const adoptCard = document.getElementById("budget-adopt-card");
  if (!status) return;

  summaryCard.classList.add("hidden");
  tableCard.classList.add("hidden");
  if (adoptCard) adoptCard.classList.add("hidden");
  budgetLastResult = null;

  if (!file) {
    status.textContent = "";
    return;
  }

  if (!window.BudgetAI) {
    status.textContent = "IA de leitura de orçamento indisponível neste navegador.";
    status.style.color = "#b45309";
    return;
  }

  const layout = getSelectedBudgetLayout();
  status.textContent = layout
    ? `Lendo orçamento com o layout "${layout.name}"...`
    : "Lendo orçamento com IA (leitura local no navegador)...";
  status.style.color = "";

  const analysis = layout ? BudgetAI.analyzeWithLayout(file, layout) : BudgetAI.analyze(file);

  analysis
    .then((result) => {
      status.textContent = `Planilha lida com sucesso (aba "${result.sheetName}")${
        layout ? ` usando o layout "${layout.name}"` : ""
      }.`;
      status.style.color = "var(--success)";
      renderBudgetResult(result);
    })
    .catch((err) => {
      status.textContent = err.message || "Não foi possível ler o orçamento enviado.";
      status.style.color = "#b45309";
    });
}

function renderBudgetResult(result) {
  const summaryCard = document.getElementById("budget-summary-card");
  const summaryBox = document.getElementById("budget-summary-box");
  const tableCard = document.getElementById("budget-table-card");
  const tbody = document.getElementById("budget-rows-tbody");

  summaryCard.classList.remove("hidden");
  summaryBox.className = result.overBudget ? "alert-warn" : "alert-ok";
  const icon = result.overBudget ? "⚠️" : "✅";
  const estouradas = result.alerts.map((a) => (a.mes ? `${a.categoria} (${a.mes})` : a.categoria)).join(", ");
  summaryBox.textContent = result.overBudget
    ? `${icon} ${result.alerts.length} categoria(s) estouraram o orçamento: ${estouradas}. ` +
      `Previsto total: R$ ${result.totalPrevisto.toFixed(2)} / Realizado total: R$ ${result.totalRealizado.toFixed(2)}.`
    : `${icon} Nenhuma categoria estourou o orçamento. ` +
      `Previsto total: R$ ${result.totalPrevisto.toFixed(2)} / Realizado total: R$ ${result.totalRealizado.toFixed(2)} ` +
      `(saldo: R$ ${result.saldoTotal.toFixed(2)}).`;

  tableCard.classList.remove("hidden");
  tbody.innerHTML = result.rows
    .map((r) => {
      const badge =
        r.status === "ESTOURADO"
          ? '<span class="badge" style="background:#fee2e2;color:#991b1b;">ESTOURADO</span>'
          : '<span class="badge" style="background:#dcfce7;color:#166534;">DENTRO DO ORÇAMENTO</span>';
      return `
      <tr>
        <td>${r.categoria}</td>
        <td>${r.mes || "-"}</td>
        <td>R$ ${r.previsto.toFixed(2)}</td>
        <td>R$ ${r.realizado.toFixed(2)}</td>
        <td>R$ ${r.saldo.toFixed(2)}</td>
        <td>${badge}</td>
      </tr>`;
    })
    .join("");

  budgetLastResult = result;
  showBudgetAdoptCard(result);
}

// Mostra o passo "Usar este orçamento no app": se a planilha tiver mais de
// um mês distinto (formato "largo" lido com vários pares Previsto/Realizado
// de uma vez), deixa escolher qual desses meses aplicar; senão, usa todas as
// linhas lidas direto.
function showBudgetAdoptCard(result) {
  const adoptCard = document.getElementById("budget-adopt-card");
  const mesField = document.getElementById("budget-adopt-mes-field");
  const mesSelect = document.getElementById("budget-adopt-mes-select");
  const status = document.getElementById("budget-adopt-status");
  if (!adoptCard) return;

  if (status) {
    status.textContent = "";
    status.style.color = "";
  }

  const distinctMeses = Array.from(new Set(result.rows.map((r) => r.mes).filter(Boolean)));
  if (mesField && mesSelect) {
    if (distinctMeses.length > 1) {
      mesSelect.innerHTML = distinctMeses.map((m) => `<option value="${m}">${m}</option>`).join("");
      mesField.classList.remove("hidden");
    } else {
      mesField.classList.add("hidden");
    }
  }

  adoptCard.classList.remove("hidden");
}

async function handleBudgetAdopt() {
  const status = document.getElementById("budget-adopt-status");
  const mesField = document.getElementById("budget-adopt-mes-field");
  const mesSelect = document.getElementById("budget-adopt-mes-select");
  const targetMonthInput = document.getElementById("budget-adopt-target-month");
  if (!status) return;

  if (!budgetLastResult || !budgetLastResult.rows || !budgetLastResult.rows.length) {
    status.textContent = "Nenhum orçamento lido ainda — envie uma planilha primeiro.";
    status.style.color = "#b45309";
    return;
  }

  const targetMonth = targetMonthInput && targetMonthInput.value;
  if (!targetMonth) {
    status.textContent = "Escolha o mês (no app) em que este orçamento vai se aplicar.";
    status.style.color = "#b45309";
    return;
  }

  const filtroMes = mesField && !mesField.classList.contains("hidden") ? mesSelect.value : null;
  const rows = budgetLastResult.rows.filter((r) => !filtroMes || r.mes === filtroMes);

  status.textContent = "Aplicando orçamento...";
  status.style.color = "";

  try {
    const result = await Api.importCategoryBudgets({
      month: targetMonth,
      rows: rows.map((r) => ({ categoria: r.categoria, previsto: r.previsto })),
    });
    status.style.color = "var(--success)";
    status.textContent =
      `✅ Orçamento de ${result.categories_count} categoria(s) aplicado para ${result.month}` +
      (result.created_categories ? ` (${result.created_categories} categoria(s) nova(s) criada(s))` : "") +
      `. Vá para a Página 2 para registrar despesas ou a Página 3 para ver a comparação.`;
  } catch (err) {
    status.style.color = "#b45309";
    status.textContent = err.message || "Não foi possível aplicar este orçamento.";
  }
}

// ---------- Modal: Configurar layout de leitura ----------

function setupBudgetLayoutModal() {
  budgetLayoutModalEl = document.getElementById("budget-layout-modal");
  if (!budgetLayoutModalEl) return;

  document.getElementById("budget-layout-modal-close").addEventListener("click", closeBudgetLayoutModal);
  document.getElementById("budget-layout-cancel").addEventListener("click", closeBudgetLayoutModal);

  document.getElementById("budget-layout-next-btn").addEventListener("click", () => {
    const nameInput = document.getElementById("layout-name");
    if (!nameInput.reportValidity()) return;
    goToBudgetLayoutPage(2);
  });
  document.getElementById("budget-layout-back-btn").addEventListener("click", () => {
    goToBudgetLayoutPage(1);
  });

  document.querySelectorAll('input[name="layout-format"]').forEach((radio) => {
    radio.addEventListener("change", updateBudgetLayoutFormatFields);
  });
}

function goToBudgetLayoutPage(page) {
  document.getElementById("layout-page-1").classList.toggle("hidden", page !== 1);
  document.getElementById("layout-page-2").classList.toggle("hidden", page !== 2);
  const indicator = document.getElementById("layout-page-indicator");
  if (indicator) indicator.textContent = `Página ${page} de 2`;
}

function updateBudgetLayoutFormatFields() {
  const checked = document.querySelector('input[name="layout-format"]:checked');
  const format = checked ? checked.value : "largo";
  document.getElementById("layout-fields-largo").classList.toggle("hidden", format !== "largo");
  document.getElementById("layout-fields-longo").classList.toggle("hidden", format !== "longo");
}

function openBudgetLayoutModal(existingLayout) {
  if (!budgetLayoutModalEl) return;
  budgetEditingLayoutId = existingLayout ? existingLayout.id : null;

  const errorBox = document.getElementById("budget-layout-error");
  errorBox.classList.add("hidden");
  goToBudgetLayoutPage(1);

  document.getElementById("layout-name").value = existingLayout ? existingLayout.name : "";

  const format = (existingLayout && existingLayout.format) || "largo";
  const formatRadio = document.querySelector(`input[name="layout-format"][value="${format}"]`);
  if (formatRadio) formatRadio.checked = true;
  updateBudgetLayoutFormatFields();

  document.getElementById("layout-col-categoria-larga").value = (existingLayout && existingLayout.colCategoriaLarga) || "";
  document.getElementById("layout-month-row").value = (existingLayout && existingLayout.monthRow) || "";
  document.getElementById("layout-subheader-row").value = (existingLayout && existingLayout.subHeaderRow) || "";

  document.getElementById("layout-header-row").value = (existingLayout && existingLayout.headerRow) || "";
  document.getElementById("layout-col-categoria").value = (existingLayout && existingLayout.colCategoria) || "";
  document.getElementById("layout-col-mes").value = (existingLayout && existingLayout.colMes) || "";
  document.getElementById("layout-col-previsto").value = (existingLayout && existingLayout.colPrevisto) || "";
  document.getElementById("layout-col-realizado").value = (existingLayout && existingLayout.colRealizado) || "";

  const sheetSelect = document.getElementById("layout-sheet");
  const desiredSheet = existingLayout ? existingLayout.sheetName : null;
  sheetSelect.innerHTML =
    '<option value="">Detectar automaticamente</option>' +
    (desiredSheet ? `<option value="${desiredSheet}" selected>${desiredSheet}</option>` : "");

  budgetLayoutModalEl.classList.remove("hidden");

  // Se já tem um arquivo selecionado na tela anterior, usa pra listar as
  // abas de verdade em vez de deixar o usuário digitar o nome às cegas.
  if (budgetSelectedFile && window.BudgetAI) {
    BudgetAI.listSheetNames(budgetSelectedFile)
      .then((names) => {
        const current = sheetSelect.value;
        sheetSelect.innerHTML =
          '<option value="">Detectar automaticamente</option>' +
          names.map((n) => `<option value="${n}">${n}</option>`).join("");
        if (current && names.includes(current)) sheetSelect.value = current;
      })
      .catch(() => {
        // não crítico: usuário ainda pode deixar em "detectar automaticamente"
      });
  }
}

function closeBudgetLayoutModal() {
  if (!budgetLayoutModalEl) return;
  budgetLayoutModalEl.classList.add("hidden");
  budgetEditingLayoutId = null;
}

document.addEventListener("submit", async (e) => {
  if (e.target && e.target.id === "budget-layout-form") {
    e.preventDefault();
    const errorBox = document.getElementById("budget-layout-error");
    errorBox.classList.add("hidden");

    const checked = document.querySelector('input[name="layout-format"]:checked');
    const format = checked ? checked.value : "largo";

    const layout = {
      id: budgetEditingLayoutId || undefined,
      name: document.getElementById("layout-name").value.trim(),
      sheetName: document.getElementById("layout-sheet").value || null,
      format,
      colCategoriaLarga: document.getElementById("layout-col-categoria-larga").value.trim() || null,
      monthRow: parseInt(document.getElementById("layout-month-row").value, 10) || null,
      subHeaderRow: parseInt(document.getElementById("layout-subheader-row").value, 10) || null,
      headerRow: parseInt(document.getElementById("layout-header-row").value, 10) || null,
      colCategoria: document.getElementById("layout-col-categoria").value.trim() || null,
      colMes: document.getElementById("layout-col-mes").value.trim() || null,
      colPrevisto: document.getElementById("layout-col-previsto").value.trim() || null,
      colRealizado: document.getElementById("layout-col-realizado").value.trim() || null,
    };

    try {
      const saved = await Api.saveBudgetLayout(layout);
      await refreshBudgetLayoutSelect();
      document.getElementById("budget-layout-select").value = saved.id;
      toggleBudgetLayoutButtons();
      closeBudgetLayoutModal();
      if (budgetSelectedFile) handleBudgetFileUpload(budgetSelectedFile);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove("hidden");
    }
  }
});

// ---------- Equipe (usuários do tenant) ----------

async function loadTeamView() {
  const users = await Api.listUsers();
  const tbody = document.getElementById("users-tbody");
  tbody.innerHTML = users
    .map(
      (u) => `<tr><td>${u.name}</td><td>${u.email}</td><td>${u.role}</td></tr>`
    )
    .join("");
}

document.addEventListener("submit", async (e) => {
  if (e.target && e.target.id === "invite-form") {
    e.preventDefault();
    const errorBox = document.getElementById("invite-error");
    errorBox.classList.add("hidden");

    const name = document.getElementById("invite-name").value.trim();
    const email = document.getElementById("invite-email").value.trim();
    const password = document.getElementById("invite-password").value;
    const role = document.getElementById("invite-role").value;

    try {
      await Api.inviteUser({ name, email, password, role });
      document.getElementById("invite-form").reset();
      await loadTeamView();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove("hidden");
    }
  }
});

// ---------- Plano (billing) ----------

async function loadPlanView() {
  const plans = await Api.plans();
  const container = document.getElementById("plans-container");
  container.innerHTML = Object.entries(plans)
    .map(([key, p]) => {
      const isCurrent = key === CURRENT_TENANT.plan;
      const canChange = CURRENT_USER.role === "admin" && !isCurrent;
      const expensesLabel = isFinite(p.max_expenses_day)
        ? `${p.max_expenses_day} despesas/dia (extra: R$ ${p.overage_price.toFixed(2)}/unidade)`
        : "Despesas ilimitadas";
      const buttonLabel = key === "free" ? "Fazer downgrade" : "Assinar com Pix";
      return `
      <div class="plan-card ${isCurrent ? "current" : ""}">
        <h3>${p.label}</h3>
        <div class="plan-price">R$ ${p.price_month.toFixed(2)} <span>/mês</span></div>
        <p class="small-muted">Acesso completo ao sistema</p>
        <p class="small-muted">${expensesLabel}</p>
        ${isCurrent ? '<p class="small-muted"><strong>Plano atual</strong></p>' : ""}
        ${canChange ? `<button class="primary" onclick="selectPlan('${key}')">${buttonLabel}</button>` : ""}
      </div>`;
    })
    .join("");

  await renderPaymentsHistory();
}

async function selectPlan(planKey) {
  // Downgrade para Free não envolve cobrança.
  if (planKey === "free") {
    await Api.changePlan(planKey);
    const me = await Api.me();
    CURRENT_TENANT = me.tenant;
    renderShell();
    await loadPlanView();
    return;
  }

  const plans = await Api.plans();
  const plan = plans[planKey];
  openPixPayment({
    amount: plan.price_month,
    description: `Assinatura ${plan.label} — Fintech Spacecworp`,
    txidPrefix: "PLANO",
    expectedType: planKey === "premium" ? "plano_premium" : "plano_free",
    onConfirm: async (txid, analysis) => {
      await Api.changePlan(planKey);
      await recordPayment({
        type: "plano",
        plan: planKey,
        amount: plan.price_month,
        txid,
        verifiedByAI: !!(analysis && analysis.amountMatches && analysis.merchantMatches),
        aiClassification: analysis ? analysis.classification : null,
      });
      const me = await Api.me();
      CURRENT_TENANT = me.tenant;
      renderShell();
      await loadPlanView();
    },
  });
}

// ---------- Pagamento via Pix (QR real + copia-e-cola, confirmação manual) ----------
//
// Histórico de pagamentos persistido via Api.listPayments/Api.addPayment,
// que gravam no "banco" (Firestore + fallback em localStorage — ver
// js/db.js e js/api.js), em vez de uma chave solta separada no
// localStorage. Assim o histórico também sincroniza entre dispositivos
// quando o Firebase está configurado.

async function recordPayment({ type, plan, amount, txid, verifiedByAI, aiClassification }) {
  await Api.addPayment({ type, plan, amount, txid, verifiedByAI, aiClassification });
}

async function renderPaymentsHistory() {
  const container = document.getElementById("payments-history");
  if (!container) return;
  const payments = await Api.listPayments();
  if (payments.length === 0) {
    container.innerHTML = '<p class="small-muted">Nenhum pagamento registrado ainda.</p>';
    return;
  }
  container.innerHTML = payments
    .map((p) => {
      const label = p.type === "plano" ? `Assinatura ${p.plan === "premium" ? "Premium" : p.plan}` : "Despesa extra (limite diário)";
      const dt = new Date(p.date);
      const typeLabel = window.ReceiptAI && ReceiptAI.TYPE_LABELS[p.aiClassification];
      // Um pagamento pode ser confirmado por até duas fontes independentes:
      // a IA de OCR local (na hora, ver js/receipt-ai.js) e/ou o agente de
      // reconciliação com o Mercado Pago (orcamento_agent/mp_reconcile.py,
      // roda localmente contra a conta real, ver LEIA-ME.md), que cruza o
      // histórico de pagamentos com os pagamentos aprovados de verdade.
      const badges = [];
      if (p.verifiedByAI) {
        badges.push(`<span style="color:var(--success);">✓ comprovante validado por IA${typeLabel ? " · " + typeLabel : ""}</span>`);
      }
      if (p.verifiedByMercadoPago) {
        badges.push(
          `<span style="color:var(--success);">✓ verificado via Mercado Pago${
            p.mercadoPagoPaymentId ? ` (pagamento #${p.mercadoPagoPaymentId})` : ""
          }</span>`
        );
      }
      if (badges.length === 0) {
        badges.push(`<span style="color:#b45309;">⚠ confirmação manual (ainda não validado por IA nem pelo Mercado Pago)</span>`);
      }
      const badge = badges.join(" · ");
      return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
        <div>
          <p style="margin:0;font-size:14px;">${label}</p>
          <p class="small-muted" style="margin:2px 0 0;">${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR").slice(0, 5)} · txid ${p.txid || "-"}</p>
          <p style="margin:2px 0 0;font-size:12px;">${badge}</p>
        </div>
        <strong style="color:var(--success);">R$ ${p.amount.toFixed(2)}</strong>
      </div>`;
    })
    .join("");
}

let pixModalEl = null;
let pixConfirmCallback = null;
let pixCurrentTxid = null;
let pixCurrentAmount = 0;
let pixExpectedType = null;
let pixReceiptAnalysis = null;
let pixReceiptInput = null;
let pixReceiptStatus = null;
let pixConfirmBtn = null;

function setupPixModal() {
  pixModalEl = document.getElementById("pix-modal");
  if (!pixModalEl) return;

  document.getElementById("pix-modal-close").addEventListener("click", closePixModal);
  document.getElementById("pix-modal-cancel").addEventListener("click", closePixModal);

  document.getElementById("pix-modal-copy").addEventListener("click", () => {
    const code = document.getElementById("pix-modal-code").textContent.trim();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code);
    }
  });

  pixReceiptInput = document.getElementById("pix-receipt-input");
  pixReceiptStatus = document.getElementById("pix-receipt-status");
  pixConfirmBtn = document.getElementById("pix-modal-confirm");

  if (pixReceiptInput) {
    pixReceiptInput.addEventListener("change", () => {
      handleReceiptUpload(pixReceiptInput.files && pixReceiptInput.files[0]);
    });
  }

  if (pixConfirmBtn) {
    pixConfirmBtn.addEventListener("click", () => {
      if (pixConfirmBtn.disabled) return;
      const cb = pixConfirmCallback;
      const txid = pixCurrentTxid;
      const analysis = pixReceiptAnalysis;
      closePixModal();
      if (cb) cb(txid, analysis);
    });
  }
}

function setPixConfirmState(enabled, label, tone) {
  if (!pixConfirmBtn) return;
  pixConfirmBtn.disabled = !enabled;
  pixConfirmBtn.textContent = label;
  pixConfirmBtn.style.opacity = enabled ? "1" : "0.5";
  pixConfirmBtn.style.background = !enabled ? "" : tone === "warn" ? "#d97706" : "";
}

// Lê o comprovante enviado com a IA (OCR local, via ReceiptAI) e confere se
// o valor/recebedor batem com o pagamento pendente. Habilita o botão de
// confirmação com um rótulo diferente conforme o resultado — o envio
// manual continua possível quando a IA não consegue validar sozinha.
function handleReceiptUpload(file) {
  pixReceiptAnalysis = null;
  setPixConfirmState(false, "Envie o comprovante");
  if (!pixReceiptStatus) return;

  if (!file) {
    pixReceiptStatus.textContent = "";
    return;
  }

  pixReceiptStatus.textContent = "Lendo comprovante com IA (OCR local no navegador)...";
  pixReceiptStatus.style.color = "";

  if (!window.ReceiptAI) {
    pixReceiptStatus.textContent = "IA de leitura indisponível neste navegador. Você pode confirmar manualmente.";
    pixReceiptStatus.style.color = "#b45309";
    setPixConfirmState(true, "Confirmar manualmente", "warn");
    return;
  }

  ReceiptAI.analyze(file, { expectedAmount: pixCurrentAmount, expectedType: pixExpectedType })
    .then((result) => {
      pixReceiptAnalysis = result;
      renderReceiptResult(result);
    })
    .catch(() => {
      pixReceiptStatus.textContent =
        "Não foi possível ler o comprovante automaticamente. Confira os dados e confirme manualmente.";
      pixReceiptStatus.style.color = "#b45309";
      setPixConfirmState(true, "Confirmar manualmente", "warn");
    });
}

function renderReceiptResult(result) {
  if (!pixReceiptStatus) return;
  const typeLabel = (window.ReceiptAI && ReceiptAI.TYPE_LABELS[result.classification]) || "Outros";

  if (result.amountMatches && result.merchantMatches) {
    pixReceiptStatus.textContent = `✅ Comprovante validado pela IA — R$ ${result.detectedAmount.toFixed(2)} · ${typeLabel}.`;
    pixReceiptStatus.style.color = "var(--success)";
    setPixConfirmState(true, "Confirmar pagamento");
  } else {
    const reasons = [];
    if (!result.merchantMatches) reasons.push("não encontramos o recebedor (SPACECWORP) no comprovante");
    if (!result.amountMatches) reasons.push(`o valor não bate com R$ ${pixCurrentAmount.toFixed(2)}`);
    pixReceiptStatus.textContent =
      `⚠️ Não deu para validar automaticamente (${reasons.join(" e ")}). Confira o comprovante ou envie mesmo assim para revisão manual.`;
    pixReceiptStatus.style.color = "#b45309";
    setPixConfirmState(true, "Enviar mesmo assim", "warn");
  }
}

// opts: { amount, description, txidPrefix, expectedType, onConfirm(txid, analysis) }
function openPixPayment({ amount, description, txidPrefix, expectedType, onConfirm }) {
  if (!pixModalEl) return;

  const txid = Pix.generateTxid(txidPrefix || "FIN");
  let payload;
  try {
    payload = Pix.buildPayload({
      key: PIX_MERCHANT.key,
      name: PIX_MERCHANT.name,
      city: PIX_MERCHANT.city,
      amount,
      description,
      txid,
    });
  } catch (e) {
    alert("Não foi possível gerar o código Pix.");
    return;
  }

  document.getElementById("pix-modal-desc").textContent = description || "";
  document.getElementById("pix-modal-amount").textContent = `R$ ${(amount || 0).toFixed(2)}`;
  document.getElementById("pix-modal-code").textContent = payload;

  pixCurrentTxid = txid;
  pixCurrentAmount = amount || 0;
  pixExpectedType = expectedType || null;
  pixReceiptAnalysis = null;
  pixConfirmCallback = typeof onConfirm === "function" ? onConfirm : null;

  if (pixReceiptInput) pixReceiptInput.value = "";
  if (pixReceiptStatus) {
    pixReceiptStatus.textContent = "";
    pixReceiptStatus.style.color = "";
  }
  setPixConfirmState(false, "Envie o comprovante");

  // Revela o modal antes de gerar o QR: se a lib externa (CDN) falhar,
  // o modal continua aparecendo com o código copia-e-cola como alternativa.
  pixModalEl.classList.remove("hidden");

  const qrEl = document.getElementById("pix-qrcode");
  qrEl.innerHTML = "";
  try {
    if (window.QRCode) {
      new QRCode(qrEl, { text: payload, width: 142, height: 142, correctLevel: QRCode.CorrectLevel.M });
    } else {
      renderPixQrFallback(qrEl, payload);
    }
  } catch (e) {
    renderPixQrFallback(qrEl, payload);
  }
}

// Alternativa caso a lib externa (CDN qrcodejs) não carregue: gera a imagem
// do QR via API pública (goqr.me), mantendo o mesmo payload Pix.
function renderPixQrFallback(qrEl, payload) {
  const img = document.createElement("img");
  img.alt = "QR Code Pix";
  img.width = 142;
  img.height = 142;
  img.src = "https://api.qrserver.com/v1/create-qr-code/?size=142x142&data=" + encodeURIComponent(payload);
  img.onerror = () => {
    qrEl.textContent = "QR indisponível — use o código copia e cola abaixo.";
  };
  qrEl.innerHTML = "";
  qrEl.appendChild(img);
}

function closePixModal() {
  if (!pixModalEl) return;
  pixModalEl.classList.add("hidden");
  pixConfirmCallback = null;
  pixCurrentTxid = null;
  pixReceiptAnalysis = null;
}
