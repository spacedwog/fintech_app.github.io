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

  setupPixModal();
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

  await refreshQuotaInfo();
  await refreshExpenseTable();
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
        <td><button class="secondary" onclick="removeExpense(${e.id})">Excluir</button></td>
      </tr>`
    )
    .join("");
}

async function removeExpense(id) {
  await Api.deleteExpense(id);
  await refreshQuotaInfo();
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
          recordPayment({
            type: "despesa_extra",
            amount: result.extra_charge,
            txid,
            verifiedByAI: !!(analysis && analysis.amountMatches && analysis.merchantMatches),
            aiClassification: analysis ? analysis.classification : null,
          });
        }
        await refreshQuotaInfo();
        await refreshExpenseTable();
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

  renderPaymentsHistory();
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
    description: `Assinatura ${plan.label} — Fintech SaaS`,
    txidPrefix: "PLANO",
    expectedType: planKey === "premium" ? "plano_premium" : "plano_free",
    onConfirm: async (txid, analysis) => {
      await Api.changePlan(planKey);
      recordPayment({
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

const PAYMENTS_KEY = "fintech_saas_payments_v1";

function loadPayments() {
  try {
    const raw = localStorage.getItem(PAYMENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function savePayments(list) {
  localStorage.setItem(PAYMENTS_KEY, JSON.stringify(list));
}

function recordPayment({ type, plan, amount, txid, verifiedByAI, aiClassification }) {
  const payments = loadPayments();
  payments.unshift({
    id: "pay-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
    tenant_id: CURRENT_TENANT.id,
    user_id: CURRENT_USER.id,
    type,
    plan: plan || null,
    amount,
    txid,
    verifiedByAI: !!verifiedByAI,
    aiClassification: aiClassification || null,
    date: new Date().toISOString(),
  });
  savePayments(payments);
}

function renderPaymentsHistory() {
  const container = document.getElementById("payments-history");
  if (!container) return;
  const payments = loadPayments().filter(
    (p) => p.tenant_id === CURRENT_TENANT.id && p.user_id === CURRENT_USER.id
  );
  if (payments.length === 0) {
    container.innerHTML = '<p class="small-muted">Nenhum pagamento registrado ainda.</p>';
    return;
  }
  container.innerHTML = payments
    .map((p) => {
      const label = p.type === "plano" ? `Assinatura ${p.plan === "premium" ? "Premium" : p.plan}` : "Despesa extra (limite diário)";
      const dt = new Date(p.date);
      const typeLabel = window.ReceiptAI && ReceiptAI.TYPE_LABELS[p.aiClassification];
      const badge = p.verifiedByAI
        ? `<span style="color:var(--success);">✓ comprovante validado por IA${typeLabel ? " · " + typeLabel : ""}</span>`
        : `<span style="color:#b45309;">⚠ confirmação manual (não validado por IA)</span>`;
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
