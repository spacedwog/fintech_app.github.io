// ===============================
// frontend/js/dashboard.js
// Lógica do painel (dashboard.html) - SPA simples com fetch
//
// Reescrito em POO: DashboardController concentra o estado e as views do
// painel; PixPaymentModal e SyncStatusIndicator são subsistemas próprios,
// compostos pelo controller. removeExpense/selectPlan continuam existindo
// como funções globais porque são chamadas via onclick="..." no HTML
// gerado dinamicamente (tabela de despesas / cartões de plano) — nesse
// caso o atributo onclick só enxerga o escopo global do navegador.
// ===============================

// Chave Pix real da SPACECWORP (a mesma usada no site principal).
const PIX_MERCHANT = { key: "62904267000160", name: "SPACECWORP", city: "OSASCO" };

// ---------- SyncStatusIndicator: bolinha de status Firebase x localStorage ----------

class SyncStatusIndicator {
  render() {
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
}

// ---------- MercadoPagoStatusIndicator: badge da sidebar com o resumo do
// que orcamento_agent/mp_expenses.py (despesas geradas) e mp_reconcile.py
// (pagamentos confirmados) já trouxeram do Mercado Pago para esta conta.
// Distinto do selo "Mercado Pago" por linha na tabela de despesas (Página 2
// do fluxo Orçamento & Despesas) — este é um resumo único, sempre visível,
// no topo da sidebar. ----------

class MercadoPagoStatusIndicator {
  async render() {
    const box = document.getElementById("mp-status");
    const label = document.getElementById("mp-status-label");
    if (!box || !label || typeof Api === "undefined") return;

    try {
      const status = await Api.getMercadoPagoStatus();
      box.classList.toggle("connected", status.connected);
      box.classList.toggle("idle", !status.connected);

      if (status.connected) {
        const plural = status.expenses_count === 1 ? "" : "s";
        label.textContent =
          `${status.expenses_count} despesa${plural} via Mercado Pago (R$ ${status.expenses_total.toFixed(2)})`;
        const lastSync = status.last_sync_date
          ? new Date(status.last_sync_date).toLocaleDateString("pt-BR")
          : "data desconhecida";
        box.title =
          `Última atualização: ${lastSync}. ${status.payments_verified_count} pagamento(s) confirmado(s) ` +
          `automaticamente (mp_reconcile.py). Despesas geradas por orcamento_agent/mp_expenses.py (via API) ` +
          `e/ou mp_email_expenses.py (via e-mail de notificação, sem token).`;
      } else {
        label.textContent = "Nenhuma despesa sincronizada ainda";
        box.title =
          "Nenhum pagamento do Mercado Pago foi importado ainda. Rode orcamento_agent/mp_reconcile.py e depois " +
          "mp_expenses.py (com Access Token) OU mp_email_expenses.py (lendo os avisos do Mercado Pago por " +
          "e-mail, sem token) -- fora do navegador -- para gerar despesas reais a partir da sua conta.";
      }
    } catch (e) {
      label.textContent = "";
      box.title = "";
    }
  }
}

// ---------- PixPaymentModal: QR real + copia-e-cola + confirmação (OCR ou manual) ----------

class PixPaymentModal {
  constructor(merchant) {
    this.merchant = merchant; // { key, name, city }
    this.modalEl = null;
    this.confirmCallback = null;
    this.currentTxid = null;
    this.currentAmount = 0;
    this.expectedType = null;
    this.receiptAnalysis = null;
    this.receiptInput = null;
    this.receiptStatus = null;
    this.confirmBtn = null;
  }

  setup() {
    this.modalEl = document.getElementById("pix-modal");
    if (!this.modalEl) return;

    document.getElementById("pix-modal-close").addEventListener("click", () => this.close());
    document.getElementById("pix-modal-cancel").addEventListener("click", () => this.close());

    document.getElementById("pix-modal-copy").addEventListener("click", () => {
      const code = document.getElementById("pix-modal-code").textContent.trim();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code);
      }
    });

    this.receiptInput = document.getElementById("pix-receipt-input");
    this.receiptStatus = document.getElementById("pix-receipt-status");
    this.confirmBtn = document.getElementById("pix-modal-confirm");

    if (this.receiptInput) {
      this.receiptInput.addEventListener("change", () => {
        this._handleReceiptUpload(this.receiptInput.files && this.receiptInput.files[0]);
      });
    }

    if (this.confirmBtn) {
      this.confirmBtn.addEventListener("click", () => {
        if (this.confirmBtn.disabled) return;
        const cb = this.confirmCallback;
        const txid = this.currentTxid;
        const analysis = this.receiptAnalysis;
        this.close();
        if (cb) cb(txid, analysis);
      });
    }
  }

  _setConfirmState(enabled, label, tone) {
    if (!this.confirmBtn) return;
    this.confirmBtn.disabled = !enabled;
    this.confirmBtn.textContent = label;
    this.confirmBtn.style.opacity = enabled ? "1" : "0.5";
    this.confirmBtn.style.background = !enabled ? "" : tone === "warn" ? "#d97706" : "";
  }

  // Lê o comprovante enviado com a IA (OCR local, via ReceiptAI) e confere se
  // o valor/recebedor batem com o pagamento pendente. Habilita o botão de
  // confirmação com um rótulo diferente conforme o resultado — o envio
  // manual continua possível quando a IA não consegue validar sozinha.
  _handleReceiptUpload(file) {
    this.receiptAnalysis = null;
    this._setConfirmState(false, "Envie o comprovante");
    if (!this.receiptStatus) return;

    if (!file) {
      this.receiptStatus.textContent = "";
      return;
    }

    this.receiptStatus.textContent = "Lendo comprovante com IA (OCR local no navegador)...";
    this.receiptStatus.style.color = "";

    if (!window.ReceiptAI) {
      this.receiptStatus.textContent = "IA de leitura indisponível neste navegador. Você pode confirmar manualmente.";
      this.receiptStatus.style.color = "#b45309";
      this._setConfirmState(true, "Confirmar manualmente", "warn");
      return;
    }

    ReceiptAI.analyze(file, { expectedAmount: this.currentAmount, expectedType: this.expectedType })
      .then((result) => {
        this.receiptAnalysis = result;
        this._renderReceiptResult(result);
      })
      .catch(() => {
        this.receiptStatus.textContent =
          "Não foi possível ler o comprovante automaticamente. Confira os dados e confirme manualmente.";
        this.receiptStatus.style.color = "#b45309";
        this._setConfirmState(true, "Confirmar manualmente", "warn");
      });
  }

  _renderReceiptResult(result) {
    if (!this.receiptStatus) return;
    const typeLabel = (window.ReceiptAI && ReceiptAI.TYPE_LABELS[result.classification]) || "Outros";

    if (result.amountMatches && result.merchantMatches) {
      this.receiptStatus.textContent = `✅ Comprovante validado pela IA — R$ ${result.detectedAmount.toFixed(2)} · ${typeLabel}.`;
      this.receiptStatus.style.color = "var(--success)";
      this._setConfirmState(true, "Confirmar pagamento");
    } else {
      const reasons = [];
      if (!result.merchantMatches) reasons.push("não encontramos o recebedor (SPACECWORP) no comprovante");
      if (!result.amountMatches) reasons.push(`o valor não bate com R$ ${this.currentAmount.toFixed(2)}`);
      this.receiptStatus.textContent =
        `⚠️ Não deu para validar automaticamente (${reasons.join(" e ")}). Confira o comprovante ou envie mesmo assim para revisão manual.`;
      this.receiptStatus.style.color = "#b45309";
      this._setConfirmState(true, "Enviar mesmo assim", "warn");
    }
  }

  // opts: { amount, description, txidPrefix, expectedType, onConfirm(txid, analysis) }
  open({ amount, description, txidPrefix, expectedType, onConfirm }) {
    if (!this.modalEl) return;

    const txid = Pix.generateTxid(txidPrefix || "FIN");
    let payload;
    try {
      payload = Pix.buildPayload({
        key: this.merchant.key,
        name: this.merchant.name,
        city: this.merchant.city,
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

    this.currentTxid = txid;
    this.currentAmount = amount || 0;
    this.expectedType = expectedType || null;
    this.receiptAnalysis = null;
    this.confirmCallback = typeof onConfirm === "function" ? onConfirm : null;

    if (this.receiptInput) this.receiptInput.value = "";
    if (this.receiptStatus) {
      this.receiptStatus.textContent = "";
      this.receiptStatus.style.color = "";
    }
    this._setConfirmState(false, "Envie o comprovante");

    // Revela o modal antes de gerar o QR: se a lib externa (CDN) falhar,
    // o modal continua aparecendo com o código copia-e-cola como alternativa.
    this.modalEl.classList.remove("hidden");

    const qrEl = document.getElementById("pix-qrcode");
    qrEl.innerHTML = "";
    try {
      if (window.QRCode) {
        new QRCode(qrEl, { text: payload, width: 142, height: 142, correctLevel: QRCode.CorrectLevel.M });
      } else {
        this._renderQrFallback(qrEl, payload);
      }
    } catch (e) {
      this._renderQrFallback(qrEl, payload);
    }
  }

  // Alternativa caso a lib externa (CDN qrcodejs) não carregue: gera a imagem
  // do QR via API pública (goqr.me), mantendo o mesmo payload Pix.
  _renderQrFallback(qrEl, payload) {
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

  close() {
    if (!this.modalEl) return;
    this.modalEl.classList.add("hidden");
    this.confirmCallback = null;
    this.currentTxid = null;
    this.receiptAnalysis = null;
  }
}

// ---------- DashboardController: shell, navegação e todas as views ----------

class DashboardController {
  constructor() {
    this.currentUser = null;
    this.currentTenant = null;
    this.monthlyChart = null;
    this.categoryChart = null;

    this.flowPagerBound = false;
    this.currentFlowPage = 1;
    this.expenseCategorySelectBound = false;
    this.budgetOverviewMonthBound = false;

    this.budgetInputBound = false;
    this.budgetSelectedFile = null;
    this.budgetLayouts = [];
    this.budgetLayoutModalEl = null;
    this.budgetEditingLayoutId = null;
    this.budgetLastResult = null; // último resultado lido (js/budget-ai.js), para o botão "Usar este orçamento no app"

    this.pixModal = new PixPaymentModal(PIX_MERCHANT);
    this.syncStatus = new SyncStatusIndicator();
    this.mpStatus = new MercadoPagoStatusIndicator();
  }

  async init() {
    if (!Auth.isLoggedIn()) {
      window.location.href = "login.html";
      return;
    }

    try {
      const me = await Api.me();
      this.currentUser = me.user;
      this.currentTenant = me.tenant;
    } catch (err) {
      Auth.clearToken();
      window.location.href = "login.html";
      return;
    }

    this.pixModal.setup();
    this._setupBudgetLayoutModal();
    this._renderShell();
    this._bindNav();
    this._bindGlobalForms();
    this.showView("budget-flow");

    // Indicador de status de sincronização com o Firebase (ver
    // getSyncStatus() em js/db.js): atualiza já ao carregar e depois
    // periodicamente, além de reagir a ficar online/offline na hora.
    this.syncStatus.render();
    setInterval(() => this.syncStatus.render(), 5000);
    window.addEventListener("online", () => this.syncStatus.render());
    window.addEventListener("offline", () => this.syncStatus.render());

    // Badge do Mercado Pago: mesmo ritmo do indicador de sincronização, já
    // que quem atualiza os dados (mp_expenses.py/mp_reconcile.py) roda fora
    // do navegador — o polling é o jeito de o painel perceber a mudança.
    this.mpStatus.render();
    setInterval(() => this.mpStatus.render(), 5000);
  }

  _renderShell() {
    document.getElementById("user-name").textContent = this.currentUser.name;
    document.getElementById("tenant-name").textContent = this.currentTenant.name;
    const planBadge = document.getElementById("tenant-plan-badge");
    planBadge.textContent = this.currentTenant.plan_details.label;
    planBadge.className = `badge ${this.currentTenant.plan}`;

    if (this.currentUser.role !== "admin") {
      document.querySelectorAll("[data-admin-only]").forEach((el) => el.classList.add("hidden"));
    }

    document.getElementById("logout-btn").addEventListener("click", () => {
      Auth.clearToken();
      window.location.href = "login.html";
    });
  }

  _bindNav() {
    document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => this.showView(btn.dataset.view));
    });
  }

  showView(viewName) {
    document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === viewName);
    });
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    document.getElementById(`view-${viewName}`).classList.remove("hidden");

    if (viewName === "budget-flow") this._loadBudgetFlowView();
    if (viewName === "reports") this._loadReportsView();
    if (viewName === "team") this._loadTeamView();
    if (viewName === "plan") this._loadPlanView();
  }

  // Registra, num único lugar, os handlers de submit dos formulários da
  // página inteira (equivalente aos vários document.addEventListener
  // ("submit", ...) delegados que o painel usava antes).
  _bindGlobalForms() {
    document.addEventListener("submit", (e) => {
      if (!e.target) return;
      switch (e.target.id) {
        case "expense-form":
          this._handleExpenseFormSubmit(e);
          break;
        case "category-form":
          this._handleCategoryFormSubmit(e);
          break;
        case "budget-form":
          this._handleBudgetFormSubmit(e);
          break;
        case "budget-layout-form":
          this._handleBudgetLayoutFormSubmit(e);
          break;
        case "invite-form":
          this._handleInviteFormSubmit(e);
          break;
        default:
          break;
      }
    });
  }

  // ---------- Orçamento & Despesas (fluxo único paginado) ----------
  //
  // Página 1 "Importar Orçamento" -> Página 2 "Registrar Despesas" -> Página 3
  // "Alertas / Orçamento". As três mantêm sua lógica própria (mais abaixo,
  // nas seções originais de cada uma) — o que fecha o ciclo entre elas é o
  // Previsto por categoria persistido na Página 1 (Api.importCategoryBudgets)
  // e lido de volta na Página 3 junto com as despesas reais da Página 2
  // (Api.getBudgetOverview).

  _loadBudgetFlowView() {
    if (!this.flowPagerBound) {
      this.flowPagerBound = true;
      this._bindFlowPager();
    }
    this._goToFlowPage(this.currentFlowPage);
  }

  _bindFlowPager() {
    document.querySelectorAll(".flow-page-dot").forEach((btn) => {
      btn.addEventListener("click", () => this._goToFlowPage(parseInt(btn.dataset.flowPage, 10)));
    });
    const prevBtn = document.getElementById("flow-prev-btn");
    const nextBtn = document.getElementById("flow-next-btn");
    if (prevBtn) prevBtn.addEventListener("click", () => this._goToFlowPage(this.currentFlowPage - 1));
    if (nextBtn) nextBtn.addEventListener("click", () => this._goToFlowPage(this.currentFlowPage + 1));
  }

  _goToFlowPage(page) {
    page = Math.min(3, Math.max(1, page));
    this.currentFlowPage = page;

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
    if (page === 1) this._loadBudgetView();
    if (page === 2) this._loadExpensesView();
    if (page === 3) {
      this._loadAlertsView();
      this._loadBudgetOverview();
    }
  }

  // ---------- Registrar Despesa ----------

  async _loadExpensesView() {
    const categories = await Api.listCategories();
    const select = document.getElementById("expense-category");
    const previous = select.value;
    select.innerHTML = categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    if (previous && categories.some((c) => c.id === previous)) select.value = previous;

    if (!this.expenseCategorySelectBound) {
      this.expenseCategorySelectBound = true;
      select.addEventListener("change", () => this._refreshExpenseCategoryBudgetInfo());
    }

    const today = new Date().toISOString().slice(0, 10);
    document.getElementById("expense-date").value = today;

    await this._refreshQuotaInfo();
    await this._refreshExpenseTable();
    await this._refreshExpenseCategoryBudgetInfo();
  }

  // Fecha o fluxo Importar Orçamento -> Registrar Despesas: mostra, para a
  // categoria selecionada no formulário, o Previsto importado na Página 1 e
  // o Realizado real já gasto neste mês (incluindo a despesa que está sendo
  // preenchida ainda não salva) — ver Api.getBudgetOverview.
  async _refreshExpenseCategoryBudgetInfo() {
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

  async _refreshQuotaInfo() {
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

  // Selo "Mercado Pago" de uma linha da tabela de despesas -- a origem
  // (generated_by_mercado_pago_source, ver ExpenseService.listExpenses em
  // js/api.js) distingue as duas formas de integração: "api"
  // (orcamento_agent/mp_expenses.py, via Access Token) ou "email"
  // (orcamento_agent/mp_email_expenses.py, lendo os avisos do Mercado Pago
  // na caixa de entrada, sem precisar de token). Despesas antigas, geradas
  // antes desse campo existir, não têm origem conhecida e mostram o selo
  // genérico de sempre.
  _mercadoPagoRowBadgeHtml(e) {
    if (!e.generated_by_mercado_pago) return "";
    const origem =
      e.generated_by_mercado_pago_source === "email"
        ? { label: "Mercado Pago (e-mail)", title: "Gerada automaticamente a partir de um e-mail de notificação do Mercado Pago (orcamento_agent/mp_email_expenses.py) -- sem Access Token." }
        : e.generated_by_mercado_pago_source === "api"
        ? { label: "Mercado Pago (API)", title: "Gerada automaticamente a partir de um pagamento real no Mercado Pago via API (orcamento_agent/mp_expenses.py)." }
        : { label: "Mercado Pago", title: "Gerada automaticamente a partir de um pagamento real no Mercado Pago (orcamento_agent/mp_expenses.py ou mp_email_expenses.py)." };
    return ` <span class="badge mp" title="${origem.title}">${origem.label}</span>`;
  }

  async _refreshExpenseTable() {
    const expenses = await Api.listExpenses();
    const tbody = document.getElementById("expenses-tbody");
    tbody.innerHTML = expenses
      .map(
        (e) => `
        <tr>
          <td>${e.date}</td>
          <td>${e.category_name || "-"}</td>
          <td>${e.description || ""}${e.is_extra ? ' <span class="badge premium" title="Despesa extra (fora do limite diário do plano Free)">extra</span>' : ""}${this._mercadoPagoRowBadgeHtml(e)}</td>
          <td>R$ ${e.amount.toFixed(2)}</td>
          <td><button class="secondary" onclick="removeExpense('${e.id}')">Excluir</button></td>
        </tr>`
      )
      .join("");

    // Mantém o badge da sidebar (contagem/total via Mercado Pago) coerente
    // com a tabela que acabou de ser recarregada — cobre init, adicionar e
    // excluir despesa sem esperar o polling de 5s do MercadoPagoStatusIndicator.
    if (this.mpStatus) this.mpStatus.render();
  }

  async removeExpense(id) {
    await Api.deleteExpense(id);
    await this._refreshQuotaInfo();
    await this._refreshExpenseTable();
    await this._refreshExpenseCategoryBudgetInfo();
  }

  async _handleExpenseFormSubmit(e) {
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
          await this._recordPayment({
            type: "despesa_extra",
            amount: result.extra_charge,
            txid,
            verifiedByAI: !!(analysis && analysis.amountMatches && analysis.merchantMatches),
            aiClassification: analysis ? analysis.classification : null,
          });
        }
        await this._refreshQuotaInfo();
        await this._refreshExpenseTable();
        await this._refreshExpenseCategoryBudgetInfo();
      };

      if (willBeExtra) {
        // Limite diário do plano Free atingido: só salva a despesa depois
        // que o comprovante do Pix de R$ 5,00 for enviado e a IA (OCR
        // local) validar o pagamento — ver PixPaymentModal.
        this.pixModal.open({
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

  async _handleCategoryFormSubmit(e) {
    e.preventDefault();
    const name = document.getElementById("new-category-name").value.trim();
    if (!name) return;
    await Api.addCategory(name);
    document.getElementById("new-category-name").value = "";
    await this._loadExpensesView();
  }

  // ---------- Resumo Mensal ----------

  async _loadReportsView() {
    const monthly = await Api.monthlyReport();
    const byCategory = await Api.categoryReport();

    const ctx1 = document.getElementById("monthly-chart").getContext("2d");
    if (this.monthlyChart) this.monthlyChart.destroy();
    this.monthlyChart = new Chart(ctx1, {
      type: "bar",
      data: {
        labels: monthly.map((m) => m.month),
        datasets: [{ label: "Gasto (R$)", data: monthly.map((m) => m.total), backgroundColor: "#2563eb" }],
      },
      options: { responsive: true, plugins: { legend: { display: false } } },
    });

    const ctx2 = document.getElementById("category-chart").getContext("2d");
    if (this.categoryChart) this.categoryChart.destroy();
    this.categoryChart = new Chart(ctx2, {
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

  async _loadAlertsView() {
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

  async _handleBudgetFormSubmit(e) {
    e.preventDefault();
    const limit_value = parseFloat(document.getElementById("budget-limit").value);
    const month = document.getElementById("budget-month").value;
    await Api.setBudget({ limit_value, month });
    await this._loadAlertsView();
  }

  // ---------- Previsto x Realizado por categoria (fecha o fluxo: dados
  // importados na Página 1 + despesas reais registradas na Página 2) ----------

  async _loadBudgetOverview(month) {
    const monthInput = document.getElementById("budget-overview-month");
    if (!this.budgetOverviewMonthBound && monthInput) {
      this.budgetOverviewMonthBound = true;
      monthInput.addEventListener("change", () => this._loadBudgetOverview(monthInput.value));
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

  _loadBudgetView() {
    if (!this.budgetInputBound) {
      this.budgetInputBound = true;

      const input = document.getElementById("budget-file-input");
      if (input) {
        input.addEventListener("change", () => {
          this.budgetSelectedFile = input.files && input.files[0];
          this._handleBudgetFileUpload(this.budgetSelectedFile);
        });
      }

      const select = document.getElementById("budget-layout-select");
      if (select) {
        select.addEventListener("change", () => {
          this._toggleBudgetLayoutButtons();
          if (this.budgetSelectedFile) this._handleBudgetFileUpload(this.budgetSelectedFile);
        });
      }

      const newBtn = document.getElementById("budget-layout-new-btn");
      if (newBtn) newBtn.addEventListener("click", () => this._openBudgetLayoutModal(null));

      const editBtn = document.getElementById("budget-layout-edit-btn");
      if (editBtn) {
        editBtn.addEventListener("click", () => {
          const layout = this._getSelectedBudgetLayout();
          if (layout) this._openBudgetLayoutModal(layout);
        });
      }

      const deleteBtn = document.getElementById("budget-layout-delete-btn");
      if (deleteBtn) {
        deleteBtn.addEventListener("click", async () => {
          const layout = this._getSelectedBudgetLayout();
          if (!layout) return;
          if (!confirm(`Excluir o layout "${layout.name}"?`)) return;
          await Api.deleteBudgetLayout(layout.id);
          await this._refreshBudgetLayoutSelect();
        });
      }

      const adoptBtn = document.getElementById("budget-adopt-btn");
      if (adoptBtn) adoptBtn.addEventListener("click", () => this._handleBudgetAdopt());
    }

    const targetMonthInput = document.getElementById("budget-adopt-target-month");
    if (targetMonthInput && !targetMonthInput.value) {
      targetMonthInput.value = new Date().toISOString().slice(0, 7);
    }

    this._refreshBudgetLayoutSelect();
  }

  _getSelectedBudgetLayout() {
    const select = document.getElementById("budget-layout-select");
    if (!select || !select.value) return null;
    return this.budgetLayouts.find((l) => l.id === select.value) || null;
  }

  _toggleBudgetLayoutButtons() {
    const hasLayout = !!this._getSelectedBudgetLayout();
    const editBtn = document.getElementById("budget-layout-edit-btn");
    const deleteBtn = document.getElementById("budget-layout-delete-btn");
    if (editBtn) editBtn.classList.toggle("hidden", !hasLayout);
    if (deleteBtn) deleteBtn.classList.toggle("hidden", !hasLayout);
  }

  async _refreshBudgetLayoutSelect() {
    const select = document.getElementById("budget-layout-select");
    if (!select) return;
    const previous = select.value;
    this.budgetLayouts = await Api.listBudgetLayouts();
    select.innerHTML =
      '<option value="">Detecção automática</option>' +
      this.budgetLayouts.map((l) => `<option value="${l.id}">${l.name}</option>`).join("");
    if (previous && this.budgetLayouts.some((l) => l.id === previous)) select.value = previous;
    this._toggleBudgetLayoutButtons();
  }

  _handleBudgetFileUpload(file) {
    const status = document.getElementById("budget-import-status");
    const summaryCard = document.getElementById("budget-summary-card");
    const tableCard = document.getElementById("budget-table-card");
    const adoptCard = document.getElementById("budget-adopt-card");
    if (!status) return;

    summaryCard.classList.add("hidden");
    tableCard.classList.add("hidden");
    if (adoptCard) adoptCard.classList.add("hidden");
    this.budgetLastResult = null;

    if (!file) {
      status.textContent = "";
      return;
    }

    if (!window.BudgetAI) {
      status.textContent = "IA de leitura de orçamento indisponível neste navegador.";
      status.style.color = "#b45309";
      return;
    }

    const layout = this._getSelectedBudgetLayout();
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
        this._renderBudgetResult(result);
      })
      .catch((err) => {
        status.textContent = err.message || "Não foi possível ler o orçamento enviado.";
        status.style.color = "#b45309";
      });
  }

  _renderBudgetResult(result) {
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

    this.budgetLastResult = result;
    this._showBudgetAdoptCard(result);
  }

  // Mostra o passo "Usar este orçamento no app": se a planilha tiver mais de
  // um mês distinto (formato "largo" lido com vários pares Previsto/Realizado
  // de uma vez), deixa escolher qual desses meses aplicar; senão, usa todas as
  // linhas lidas direto.
  _showBudgetAdoptCard(result) {
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

  async _handleBudgetAdopt() {
    const status = document.getElementById("budget-adopt-status");
    const mesField = document.getElementById("budget-adopt-mes-field");
    const mesSelect = document.getElementById("budget-adopt-mes-select");
    const targetMonthInput = document.getElementById("budget-adopt-target-month");
    if (!status) return;

    if (!this.budgetLastResult || !this.budgetLastResult.rows || !this.budgetLastResult.rows.length) {
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
    const rows = this.budgetLastResult.rows.filter((r) => !filtroMes || r.mes === filtroMes);

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

  _setupBudgetLayoutModal() {
    this.budgetLayoutModalEl = document.getElementById("budget-layout-modal");
    if (!this.budgetLayoutModalEl) return;

    document.getElementById("budget-layout-modal-close").addEventListener("click", () => this._closeBudgetLayoutModal());
    document.getElementById("budget-layout-cancel").addEventListener("click", () => this._closeBudgetLayoutModal());

    document.getElementById("budget-layout-next-btn").addEventListener("click", () => {
      const nameInput = document.getElementById("layout-name");
      if (!nameInput.reportValidity()) return;
      this._goToBudgetLayoutPage(2);
    });
    document.getElementById("budget-layout-back-btn").addEventListener("click", () => {
      this._goToBudgetLayoutPage(1);
    });

    document.querySelectorAll('input[name="layout-format"]').forEach((radio) => {
      radio.addEventListener("change", () => this._updateBudgetLayoutFormatFields());
    });
  }

  _goToBudgetLayoutPage(page) {
    document.getElementById("layout-page-1").classList.toggle("hidden", page !== 1);
    document.getElementById("layout-page-2").classList.toggle("hidden", page !== 2);
    const indicator = document.getElementById("layout-page-indicator");
    if (indicator) indicator.textContent = `Página ${page} de 2`;
  }

  _updateBudgetLayoutFormatFields() {
    const checked = document.querySelector('input[name="layout-format"]:checked');
    const format = checked ? checked.value : "largo";
    document.getElementById("layout-fields-largo").classList.toggle("hidden", format !== "largo");
    document.getElementById("layout-fields-longo").classList.toggle("hidden", format !== "longo");
  }

  _openBudgetLayoutModal(existingLayout) {
    if (!this.budgetLayoutModalEl) return;
    this.budgetEditingLayoutId = existingLayout ? existingLayout.id : null;

    const errorBox = document.getElementById("budget-layout-error");
    errorBox.classList.add("hidden");
    this._goToBudgetLayoutPage(1);

    document.getElementById("layout-name").value = existingLayout ? existingLayout.name : "";

    const format = (existingLayout && existingLayout.format) || "largo";
    const formatRadio = document.querySelector(`input[name="layout-format"][value="${format}"]`);
    if (formatRadio) formatRadio.checked = true;
    this._updateBudgetLayoutFormatFields();

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

    this.budgetLayoutModalEl.classList.remove("hidden");

    // Se já tem um arquivo selecionado na tela anterior, usa pra listar as
    // abas de verdade em vez de deixar o usuário digitar o nome às cegas.
    if (this.budgetSelectedFile && window.BudgetAI) {
      BudgetAI.listSheetNames(this.budgetSelectedFile)
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

  _closeBudgetLayoutModal() {
    if (!this.budgetLayoutModalEl) return;
    this.budgetLayoutModalEl.classList.add("hidden");
    this.budgetEditingLayoutId = null;
  }

  async _handleBudgetLayoutFormSubmit(e) {
    e.preventDefault();
    const errorBox = document.getElementById("budget-layout-error");
    errorBox.classList.add("hidden");

    const checked = document.querySelector('input[name="layout-format"]:checked');
    const format = checked ? checked.value : "largo";

    const layout = {
      id: this.budgetEditingLayoutId || undefined,
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
      await this._refreshBudgetLayoutSelect();
      document.getElementById("budget-layout-select").value = saved.id;
      this._toggleBudgetLayoutButtons();
      this._closeBudgetLayoutModal();
      if (this.budgetSelectedFile) this._handleBudgetFileUpload(this.budgetSelectedFile);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove("hidden");
    }
  }

  // ---------- Equipe (usuários do tenant) ----------

  async _loadTeamView() {
    const users = await Api.listUsers();
    const tbody = document.getElementById("users-tbody");
    tbody.innerHTML = users
      .map(
        (u) => `<tr><td>${u.name}</td><td>${u.email}</td><td>${u.role}</td></tr>`
      )
      .join("");
  }

  async _handleInviteFormSubmit(e) {
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
      await this._loadTeamView();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove("hidden");
    }
  }

  // ---------- Plano (billing) ----------

  async _loadPlanView() {
    const plans = await Api.plans();
    const container = document.getElementById("plans-container");
    container.innerHTML = Object.entries(plans)
      .map(([key, p]) => {
        const isCurrent = key === this.currentTenant.plan;
        const canChange = this.currentUser.role === "admin" && !isCurrent;
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

    await this._renderPaymentsHistory();
  }

  async selectPlan(planKey) {
    // Downgrade para Free não envolve cobrança.
    if (planKey === "free") {
      await Api.changePlan(planKey);
      const me = await Api.me();
      this.currentTenant = me.tenant;
      this._renderShell();
      await this._loadPlanView();
      return;
    }

    const plans = await Api.plans();
    const plan = plans[planKey];
    this.pixModal.open({
      amount: plan.price_month,
      description: `Assinatura ${plan.label} — Fintech Spacecworp`,
      txidPrefix: "PLANO",
      expectedType: planKey === "premium" ? "plano_premium" : "plano_free",
      onConfirm: async (txid, analysis) => {
        await Api.changePlan(planKey);
        await this._recordPayment({
          type: "plano",
          plan: planKey,
          amount: plan.price_month,
          txid,
          verifiedByAI: !!(analysis && analysis.amountMatches && analysis.merchantMatches),
          aiClassification: analysis ? analysis.classification : null,
        });
        const me = await Api.me();
        this.currentTenant = me.tenant;
        this._renderShell();
        await this._loadPlanView();
      },
    });
  }

  // ---------- Pagamento via Pix (histórico) ----------
  //
  // Histórico de pagamentos persistido via Api.listPayments/Api.addPayment,
  // que gravam no "banco" (Firestore + fallback em localStorage — ver
  // js/db.js e js/api.js), em vez de uma chave solta separada no
  // localStorage. Assim o histórico também sincroniza entre dispositivos
  // quando o Firebase está configurado.

  async _recordPayment({ type, plan, amount, txid, verifiedByAI, aiClassification }) {
    await Api.addPayment({ type, plan, amount, txid, verifiedByAI, aiClassification });
  }

  async _renderPaymentsHistory() {
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
}

// ---------- ponto de entrada ----------

let dashboardController = null;

document.addEventListener("DOMContentLoaded", () => {
  dashboardController = new DashboardController();
  dashboardController.init();
});

// Expostas globalmente porque o HTML gerado dinamicamente (tabela de
// despesas / cartões de plano) usa onclick="..." — atributos inline só
// enxergam o escopo global do navegador, não métodos de instância.
function removeExpense(id) {
  return dashboardController && dashboardController.removeExpense(id);
}

function selectPlan(planKey) {
  return dashboardController && dashboardController.selectPlan(planKey);
}
