// ===============================
// frontend/js/dashboard.js
// Lógica do painel (dashboard.html) - SPA simples com fetch
// ===============================

let CURRENT_USER = null;
let CURRENT_TENANT = null;
let monthlyChart = null;
let categoryChart = null;

document.addEventListener("DOMContentLoaded", async () => {
  if (!Auth.isLoggedIn()) {
    window.location.href = "index.html";
    return;
  }

  try {
    const me = await Api.me();
    CURRENT_USER = me.user;
    CURRENT_TENANT = me.tenant;
  } catch (err) {
    Auth.clearToken();
    window.location.href = "index.html";
    return;
  }

  renderShell();
  bindNav();
  showView("expenses");
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
    window.location.href = "index.html";
  });
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

  if (viewName === "expenses") loadExpensesView();
  if (viewName === "reports") loadReportsView();
  if (viewName === "alerts") loadAlertsView();
  if (viewName === "team") loadTeamView();
  if (viewName === "plan") loadPlanView();
}

// ---------- Registrar Despesa ----------

async function loadExpensesView() {
  const categories = await Api.listCategories();
  const select = document.getElementById("expense-category");
  select.innerHTML = categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("expense-date").value = today;

  await refreshExpenseTable();
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
        <td>${e.description || ""}</td>
        <td>R$ ${e.amount.toFixed(2)}</td>
        <td><button class="secondary" onclick="removeExpense(${e.id})">Excluir</button></td>
      </tr>`
    )
    .join("");
}

async function removeExpense(id) {
  await Api.deleteExpense(id);
  await refreshExpenseTable();
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
    const category_id = parseInt(document.getElementById("expense-category").value, 10);

    try {
      await Api.addExpense({ amount, date, description, category_id });
      successBox.textContent = "Despesa registrada!";
      successBox.classList.remove("hidden");
      document.getElementById("expense-form").reset();
      document.getElementById("expense-date").value = new Date().toISOString().slice(0, 10);
      await refreshExpenseTable();
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

document.addEventListener("submit", async (e) => {
  if (e.target && e.target.id === "budget-form") {
    e.preventDefault();
    const limit_value = parseFloat(document.getElementById("budget-limit").value);
    const month = document.getElementById("budget-month").value;
    await Api.setBudget({ limit_value, month });
    await loadAlertsView();
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
      return `
      <div class="plan-card ${isCurrent ? "current" : ""}">
        <h3>${p.label}</h3>
        <div class="plan-price">R$ ${p.price_month.toFixed(2)} <span>/mês</span></div>
        <p class="small-muted">${p.max_users} usuários · ${p.max_expenses_month} despesas/mês</p>
        ${isCurrent ? '<p class="small-muted"><strong>Plano atual</strong></p>' : ""}
        ${canChange ? `<button class="primary" onclick="selectPlan('${key}')">Escolher</button>` : ""}
      </div>`;
    })
    .join("");
}

async function selectPlan(planKey) {
  await Api.changePlan(planKey);
  const me = await Api.me();
  CURRENT_TENANT = me.tenant;
  renderShell();
  await loadPlanView();
}
