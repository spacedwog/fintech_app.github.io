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
// que os agentes Mercado Pago/Open Finance já trouxeram para esta conta
// (mp_reconcile.py, mp_expenses.py, mp_open_finance_sync.py e
// mp_oauth_account_sync.py).
// Distinto do selo "Mercado Pago" por linha na tabela de despesas (Menu
// Despesas) — este é um resumo único, sempre visível,
// no topo da sidebar. ----------

class MercadoPagoStatusIndicator {
  constructor() {}

  _formatAgo(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return "agora mesmo";
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `há ${diffH}h`;
    const diffD = Math.round(diffH / 24);
    return `há ${diffD}d (${d.toLocaleDateString("pt-BR")})`;
  }

  async render() {
    const box = document.getElementById("mp-status");
    const label = document.getElementById("mp-status-label");
    if (!box || !label || typeof Api === "undefined") return;

    try {
      const status = await Api.getMercadoPagoStatus();
      box.classList.toggle("connected", status.connected);
      box.classList.toggle("idle", !status.connected);

      const agoAutomacao = this._formatAgo(status.last_run_at);

      if (status.connected) {
        const plural = status.expenses_count === 1 ? "" : "s";
        label.textContent =
          `${status.expenses_count} despesa${plural} via Mercado Pago (R$ ${status.expenses_total.toFixed(2)})` +
          (agoAutomacao ? ` · sync ${agoAutomacao}` : "");
        const lastSync = status.last_sync_date
          ? new Date(status.last_sync_date).toLocaleDateString("pt-BR")
          : "data desconhecida";
        box.title =
          `Última atualização: ${lastSync}. ${status.payments_verified_count} pagamento(s) confirmado(s) ` +
          `automaticamente (mp_reconcile.py). Despesas geradas por orcamento_agent/mp_expenses.py e ` +
          `sincronizações de Open Finance/OAuth (mp_open_finance_sync.py, mp_oauth_account_sync.py).` +
          (agoAutomacao ? ` Última execução dos agentes: ${agoAutomacao}.` : "");
      } else if (status.automation_configured) {
        // Agente já rodou (ex.: via GitHub Actions) mas ainda não gerou
        // nenhuma despesa/confirmação nesta janela -- diferente de "nunca
        // configurado", vale deixar isso claro no rótulo.
        label.textContent = `Integração ativa, sem novidades (sync ${agoAutomacao || "recente"})`;
        box.title = "A automação do Mercado Pago já rodou, mas não encontrou pagamento novo para importar/confirmar.";
      } else {
        label.textContent = "Nenhuma despesa sincronizada ainda";
        box.title =
          "Nenhum pagamento do Mercado Pago foi importado ainda. Configure orcamento_agent/mp_reconcile.py + " +
          "mp_expenses.py + mp_open_finance_sync.py/mp_oauth_account_sync.py (quando aplicável) fora do navegador, " +
          "ou agende via GitHub Actions (veja orcamento_agent/LEIA-ME.md).";
      }
    } catch (e) {
      label.textContent = "";
      box.title = "";
    }
  }
}

// ---------- ManualTransactionModal: quando a leitura automática (OCR) do
// comprovante não é possível (formato não suportado, motor de OCR/PDF.js
// indisponível, PDF corrompido etc.), abre este modal para o usuário
// digitar o número/código de autenticação da transação que aparece no
// comprovante bancário, permitindo confirmar manualmente mesmo assim.
// Compartilhado entre a confirmação de pagamento Pix (PixPaymentModal) e o
// upload de comprovante de despesa (DashboardController). ----------

class ManualTransactionModal {
  constructor() {
    this.modalEl = null;
    this.inputEl = null;
    this.errorEl = null;
    this.descEl = null;
    this.confirmBtn = null;
    this.onConfirm = null;
    this.onCancel = null;
  }

  setup() {
    this.modalEl = document.getElementById("manual-txn-modal");
    if (!this.modalEl) return;

    this.inputEl = document.getElementById("manual-txn-input");
    this.errorEl = document.getElementById("manual-txn-error");
    this.descEl = document.getElementById("manual-txn-modal-desc");
    this.confirmBtn = document.getElementById("manual-txn-confirm");

    const closeBtn = document.getElementById("manual-txn-modal-close");
    const cancelBtn = document.getElementById("manual-txn-cancel");
    if (closeBtn) closeBtn.addEventListener("click", () => this._cancel());
    if (cancelBtn) cancelBtn.addEventListener("click", () => this._cancel());

    if (this.confirmBtn) {
      this.confirmBtn.addEventListener("click", () => this._submit());
    }
    if (this.inputEl) {
      this.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this._submit();
        }
      });
    }
  }

  _submit() {
    const value = ((this.inputEl && this.inputEl.value) || "").trim();
    if (!value) {
      if (this.errorEl) {
        this.errorEl.textContent = "Informe o número da transação.";
        this.errorEl.classList.remove("hidden");
      }
      return;
    }
    const cb = this.onConfirm;
    this._close();
    if (cb) cb(value);
  }

  _cancel() {
    const cb = this.onCancel;
    this._close();
    if (cb) cb();
  }

  // opts: { reason (string opcional, explica por que a leitura falhou),
  //         onConfirm(txnNumber), onCancel() }
  open(opts) {
    opts = opts || {};
    if (!this.modalEl) return;

    this.onConfirm = typeof opts.onConfirm === "function" ? opts.onConfirm : null;
    this.onCancel = typeof opts.onCancel === "function" ? opts.onCancel : null;

    if (this.descEl) {
      const intro = opts.reason ? `${opts.reason} ` : "Não foi possível ler o comprovante automaticamente. ";
      this.descEl.textContent =
        intro + "Informe o número (ou código de autenticação) da transação que aparece no comprovante para confirmar manualmente.";
    }
    if (this.inputEl) this.inputEl.value = "";
    if (this.errorEl) this.errorEl.classList.add("hidden");

    this.modalEl.classList.remove("hidden");
    if (this.inputEl) setTimeout(() => this.inputEl.focus(), 0);
  }

  _close() {
    if (!this.modalEl) return;
    this.modalEl.classList.add("hidden");
    this.onConfirm = null;
    this.onCancel = null;
  }
}

// ---------- PixPaymentModal: QR real + copia-e-cola + confirmação (OCR ou manual) ----------

class PixPaymentModal {
  constructor(merchant, manualTxnModal) {
    this.merchant = merchant; // { key, name, city }
    this.manualTxnModal = manualTxnModal || null;
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

    const manualBtn = document.getElementById("pix-receipt-manual-btn");
    if (manualBtn) {
      manualBtn.addEventListener("click", () => this._promptManualTxn(null));
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
      const reason = "IA de leitura indisponível neste navegador.";
      this.receiptStatus.textContent = `${reason} Informe o número da transação para confirmar manualmente.`;
      this.receiptStatus.style.color = "#b45309";
      this._setConfirmState(false, "Informe o número da transação");
      this._promptManualTxn(reason);
      return;
    }

    ReceiptAI.analyze(file, { expectedAmount: this.currentAmount, expectedType: this.expectedType })
      .then((result) => {
        this.receiptAnalysis = result;
        this._renderReceiptResult(result);
      })
      .catch((err) => {
        const reason = (err && err.message) || "Não foi possível ler o comprovante automaticamente.";
        this.receiptStatus.textContent = `${reason} Informe o número da transação para confirmar manualmente.`;
        this.receiptStatus.style.color = "#b45309";
        this._setConfirmState(false, "Informe o número da transação");
        this._promptManualTxn(reason);
      });
  }

  // Abre o ManualTransactionModal (leitura automática indisponível/falhou)
  // e, se o usuário informar o número, guarda como receiptAnalysis "manual"
  // (sem validação de IA) e libera a confirmação com um rótulo de alerta.
  _promptManualTxn(reason) {
    if (!this.manualTxnModal) return;
    this.manualTxnModal.open({
      reason,
      onConfirm: (txnNumber) => {
        this.receiptAnalysis = { ok: false, manualTxnNumber: txnNumber };
        this.receiptStatus.textContent = `📝 Nº da transação informado manualmente: ${txnNumber}. Confira o comprovante antes de confirmar.`;
        this.receiptStatus.style.color = "#b45309";
        this._setConfirmState(true, "Confirmar manualmente", "warn");
      },
      onCancel: () => {
        this._setConfirmState(false, "Informe o número da transação");
      },
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

    this.budgetFlowPagerBound = false;
    this.currentBudgetFlowPage = 1;
    this.expensesFlowPagerBound = false;
    this.currentExpensesFlowPage = 1;
    this.securityPrivacyPagerBound = false;
    this.currentSecurityPrivacyPage = 1;
    this.expenseCategorySelectBound = false;
    this.budgetOverviewMonthBound = false;
    this.budgetManageBound = false;
    this.budgetGroupsBound = false;
    this.feedBound = false;

    this.budgetInputBound = false;
    this.pixKeyPaymentBound = false;
    this.budgetSelectedFile = null;
    this.budgetLayouts = [];
    this.budgetLayoutModalEl = null;
    this.budgetEditingLayoutId = null;
    this.budgetLastResult = null; // último resultado lido (js/budget-ai.js), para o botão "Usar este orçamento no app"
    this.googleChatLoading = false;

    this.manualTxnModal = new ManualTransactionModal();
    this.pixModal = new PixPaymentModal(PIX_MERCHANT, this.manualTxnModal);
    this.syncStatus = new SyncStatusIndicator();
    this.mpStatus = new MercadoPagoStatusIndicator();

    this.securityBound = false;
    this.privacyBound = false;
    this.settingsBound = false;
  }

  async init() {
    if (!Auth.isLoggedIn()) {
      window.location.href = "login.html";
      return;
    }

    // Verificação criptográfica de verdade do access_token OAuth (assinatura
    // HMAC + expiração — ver SessionManager.verifySession em js/api.js),
    // com renovação automática via refresh_token se o access_token já
    // expirou. Só depois disso confiamos na sessão para carregar o painel.
    const sessionOk = await Auth.verifySession();
    if (!sessionOk) {
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

    this.manualTxnModal.setup();
    this.pixModal.setup();
    this._setupGoogleAIChatbot();
    this._setupPixKeyPayment();
    // Botão ⟳ ao lado do badge do Mercado Pago: só reconsulta o status
    // (Api.getMercadoPagoStatus), sem abrir nenhuma configuração.
    const mpRefreshBtn = document.getElementById("mp-refresh-btn");
    if (mpRefreshBtn) {
      mpRefreshBtn.addEventListener("click", async () => {
        mpRefreshBtn.classList.add("spinning");
        try {
          await this.mpStatus.render();
        } finally {
          mpRefreshBtn.classList.remove("spinning");
        }
      });
    }
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

  _setActiveNav(viewName) {
    document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === viewName);
    });
  }

  showView(viewName) {
    if (viewName === "security") {
      this.currentSecurityPrivacyPage = 1;
      return this.showView("security-privacy");
    }
    if (viewName === "privacy") {
      this.currentSecurityPrivacyPage = 2;
      return this.showView("security-privacy");
    }
    if (viewName === "security-privacy") {
      this._setActiveNav("security-privacy");
      this._loadSecurityPrivacyView();
      return;
    }

    this._setActiveNav(viewName);
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    document.getElementById(`view-${viewName}`).classList.remove("hidden");

    if (viewName === "budget-flow") this._loadBudgetFlowView();
    if (viewName === "expenses-flow") this._loadExpensesFlowView();
    if (viewName === "feed") this._loadFeedView();
    if (viewName === "reports") this._loadReportsView();
    if (viewName === "team") this._loadTeamView();
    if (viewName === "plan") this._loadPlanView();
    if (viewName === "settings") this._loadSettingsView();
  }

  _loadSecurityPrivacyView() {
    if (!this.securityPrivacyPagerBound) {
      this.securityPrivacyPagerBound = true;
      this._bindSecurityPrivacyPager();
    }
    this._goToSecurityPrivacyPage(this.currentSecurityPrivacyPage);
  }

  _bindSecurityPrivacyPager() {
    document.querySelectorAll("[data-account-page]").forEach((btn) => {
      btn.addEventListener("click", () => this._goToSecurityPrivacyPage(parseInt(btn.dataset.accountPage, 10)));
    });
    document.querySelectorAll('[data-account-nav="prev"]').forEach((btn) => {
      btn.addEventListener("click", () => this._goToSecurityPrivacyPage(this.currentSecurityPrivacyPage - 1));
    });
    document.querySelectorAll('[data-account-nav="next"]').forEach((btn) => {
      btn.addEventListener("click", () => this._goToSecurityPrivacyPage(this.currentSecurityPrivacyPage + 1));
    });
  }

  _goToSecurityPrivacyPage(page) {
    const nextPage = Math.max(1, Math.min(2, Number(page) || 1));
    this.currentSecurityPrivacyPage = nextPage;

    const isSecurity = nextPage === 1;
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    document.getElementById("view-security").classList.toggle("hidden", !isSecurity);
    document.getElementById("view-privacy").classList.toggle("hidden", isSecurity);

    document.querySelectorAll(".account-page-dot").forEach((btn) => {
      const btnPage = parseInt(btn.dataset.accountPage, 10);
      btn.classList.toggle("active", btnPage === nextPage);
    });
    document.querySelectorAll(".account-page-indicator").forEach((el) => {
      el.textContent = `Página ${nextPage} de 2`;
    });
    document.querySelectorAll('[data-account-nav="prev"]').forEach((btn) => {
      btn.disabled = nextPage === 1;
    });
    document.querySelectorAll('[data-account-nav="next"]').forEach((btn) => {
      btn.disabled = nextPage === 2;
    });

    if (isSecurity) this._loadSecurityView();
    else this._loadPrivacyView();
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
        case "pix-key-payment-form":
          this._handlePixKeyPaymentFormSubmit(e);
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
        case "settings-profile-form":
          this._handleProfileFormSubmit(e);
          break;
        case "settings-password-form":
          this._handlePasswordFormSubmit(e);
          break;
        default:
          break;
      }
    });
  }

  // ---------- Orçamento (fluxo paginado) ----------

  _loadBudgetFlowView() {
    if (!this.budgetFlowPagerBound) {
      this.budgetFlowPagerBound = true;
      this._bindBudgetFlowPager();
    }
    this._goToBudgetFlowPage(this.currentBudgetFlowPage);
  }

  _bindBudgetFlowPager() {
    document.querySelectorAll(".budget-flow-page-dot").forEach((btn) => {
      btn.addEventListener("click", () => this._goToBudgetFlowPage(parseInt(btn.dataset.budgetFlowPage, 10)));
    });
    const prevBtn = document.getElementById("budget-flow-prev-btn");
    const nextBtn = document.getElementById("budget-flow-next-btn");
    if (prevBtn) prevBtn.addEventListener("click", () => this._goToBudgetFlowPage(this.currentBudgetFlowPage - 1));
    if (nextBtn) nextBtn.addEventListener("click", () => this._goToBudgetFlowPage(this.currentBudgetFlowPage + 1));
  }

  _loadExpensesFlowView() {
    if (!this.expensesFlowPagerBound) {
      this.expensesFlowPagerBound = true;
      this._bindExpensesFlowPager();
    }
    this._goToExpensesFlowPage(this.currentExpensesFlowPage);
  }

  _bindExpensesFlowPager() {
    document.querySelectorAll(".expenses-flow-page-dot").forEach((btn) => {
      btn.addEventListener("click", () => this._goToExpensesFlowPage(parseInt(btn.dataset.expensesFlowPage, 10)));
    });
    const prevBtn = document.getElementById("expenses-flow-prev-btn");
    const nextBtn = document.getElementById("expenses-flow-next-btn");
    if (prevBtn) prevBtn.addEventListener("click", () => this._goToExpensesFlowPage(this.currentExpensesFlowPage - 1));
    if (nextBtn) nextBtn.addEventListener("click", () => this._goToExpensesFlowPage(this.currentExpensesFlowPage + 1));
  }

  _setupGoogleAIChatbot() {
    const sendBtn = document.getElementById("google-ai-chat-send");
    const clearBtn = document.getElementById("google-ai-chat-clear");
    const input = document.getElementById("google-ai-chat-input");

    if (!sendBtn || !clearBtn || !input) return;

    sendBtn.addEventListener("click", () => this._sendGoogleAIChatMessage());
    clearBtn.addEventListener("click", () => this._clearGoogleAIChat());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this._sendGoogleAIChatMessage();
      }
    });
  }

  _setupPixKeyPayment() {
    if (this.pixKeyPaymentBound) return;
    const form = document.getElementById("pix-key-payment-form");
    if (!form) return;
    this.pixKeyPaymentBound = true;

    const dateInput = document.getElementById("pix-key-date");
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);

    const copyBtn = document.getElementById("pix-key-copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const codeEl = document.getElementById("pix-key-copy-code");
        const code = String((codeEl && codeEl.textContent) || "").trim();
        if (!code) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code);
        }
      });
    }
  }

  _getCopilotChatAgent() {
    return window.GitHubCopilotAgent || window.GoogleAIChatbot || window.GitHubExpenseAgent || null;
  }

  _appendGoogleAIChatMessage(type, text) {
    const box = document.getElementById("google-ai-chat-messages");
    if (!box) return;
    const el = document.createElement("div");
    el.className = `google-ai-msg ${type === "user" ? "user" : "bot"}`;
    el.textContent = String(text || "");
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  _setGoogleAIChatStatus(message, isError) {
    const status = document.getElementById("google-ai-chat-status");
    if (!status) return;
    status.textContent = message || "";
    status.style.color = isError ? "#b45309" : "";
  }

  _extractExpensesFromChatbotText(text) {
    const raw = String(text || "");
    const payloads = [];
    const blockRe = /```(?:json)?\s*([\s\S]*?)```/gi;
    let blockMatch;
    while ((blockMatch = blockRe.exec(raw))) {
      payloads.push(blockMatch[1]);
    }
    if (!payloads.length) payloads.push(raw);

    const today = new Date().toISOString().slice(0, 10);
    const normalized = [];
    for (const payload of payloads) {
      let parsed = null;
      try {
        parsed = JSON.parse(payload);
      } catch (_err) {
        continue;
      }
      const items = Array.isArray(parsed) ? parsed : parsed && (parsed.despesas || parsed.expenses);
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const rawAmount = item.amount != null ? item.amount : item.valor;
        const amount = Number(String(rawAmount).replace(",", "."));
        if (!isFinite(amount) || amount <= 0) continue;
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || item.data || "")) ? String(item.date || item.data) : today;
        normalized.push({
          amount,
          date,
          description: String(item.description || item.descricao || "Despesa via chatbot"),
          categoryName: String(item.category || item.categoria || "").trim(),
          transactionNumber: String(
            item.transaction_number ||
              item.transactionNumber ||
              item.txnNumber ||
              item.txid ||
              item.numero_transacao ||
              item.numeroTransacao ||
              ""
          ).trim(),
        });
      }
    }
    return normalized;
  }

  async _importExpensesFromChatbotText(text) {
    const expenses = this._extractExpensesFromChatbotText(text);
    if (!expenses.length) return 0;

    const categories = await Api.listCategories();
    const byName = new Map(categories.map((c) => [String(c.name || "").trim().toLowerCase(), c]));
    let imported = 0;

    for (const expense of expenses) {
      let categoryId = null;
      if (expense.categoryName) {
        const key = expense.categoryName.toLowerCase();
        let category = byName.get(key);
        if (!category) {
          await Api.addCategory(expense.categoryName);
          const refreshed = await Api.listCategories();
          byName.clear();
          refreshed.forEach((c) => byName.set(String(c.name || "").trim().toLowerCase(), c));
          category = byName.get(key) || null;
        }
        categoryId = category ? category.id : null;
      }

      await Api.addExpense({
        amount: expense.amount,
        date: expense.date,
        description: expense.description,
        category_id: categoryId,
        transaction_number: expense.transactionNumber || null,
      });
      imported++;
    }

    return imported;
  }

  _clearGoogleAIChat() {
    const box = document.getElementById("google-ai-chat-messages");
    if (box) {
      box.innerHTML = "";
      const welcome = document.createElement("div");
      welcome.className = "google-ai-msg bot";
      welcome.textContent = "Conversa limpa. Como posso ajudar agora?";
      box.appendChild(welcome);
    }
    const agent = this._getCopilotChatAgent();
    if (agent && typeof agent.clear === "function") agent.clear();
    this._setGoogleAIChatStatus("Histórico limpo.", false);
  }

  async _sendGoogleAIChatMessage() {
    if (this.googleChatLoading) return;

    const githubUserInput = document.getElementById("github-agent-username");
    const msgInput = document.getElementById("google-ai-chat-input");
    const sendBtn = document.getElementById("google-ai-chat-send");

    if (!msgInput || !sendBtn) return;
    const agent = this._getCopilotChatAgent();
    if (!agent) {
      this._setGoogleAIChatStatus("Agente GitHub Copilot indisponível neste navegador.", true);
      return;
    }

    const message = String(msgInput.value || "").trim();
    const githubUser = String((githubUserInput && githubUserInput.value) || "").trim();
    if (!message) {
      this._setGoogleAIChatStatus("Digite uma mensagem.", true);
      return;
    }
    this._appendGoogleAIChatMessage("user", message);
    msgInput.value = "";
    this.googleChatLoading = true;
    sendBtn.disabled = true;
    this._setGoogleAIChatStatus("Consultando o agente GitHub Copilot...", false);

    try {
      const result = await agent.sendMessage({
        message,
        githubUser,
      });
      this._appendGoogleAIChatMessage("bot", result.text);
      const imported = await this._importExpensesFromChatbotText(result.text);
      if (imported > 0) {
        await this._loadExpensesView();
        this._setGoogleAIChatStatus(`${imported} despesa(s) adicionada(s) em Minhas despesas.`, false);
      } else {
        this._setGoogleAIChatStatus("Resposta recebida.", false);
      }
    } catch (err) {
      this._appendGoogleAIChatMessage("bot", "Não consegui responder agora. Tente novamente em instantes.");
      this._setGoogleAIChatStatus((err && err.message) || "Falha ao consultar o agente GitHub Copilot.", true);
    } finally {
      this.googleChatLoading = false;
      sendBtn.disabled = false;
    }
  }

  _goToBudgetFlowPage(page) {
    page = Math.min(4, Math.max(1, page));
    this.currentBudgetFlowPage = page;

    document.querySelectorAll(".budget-flow-page").forEach((el, idx) => {
      el.classList.toggle("hidden", idx + 1 !== page);
    });
    document.querySelectorAll(".budget-flow-page-dot").forEach((btn) => {
      btn.classList.toggle("active", parseInt(btn.dataset.budgetFlowPage, 10) === page);
    });
    const indicator = document.getElementById("budget-flow-page-indicator");
    if (indicator) indicator.textContent = `Página ${page} de 4`;
    const prevBtn = document.getElementById("budget-flow-prev-btn");
    const nextBtn = document.getElementById("budget-flow-next-btn");
    if (prevBtn) prevBtn.disabled = page === 1;
    if (nextBtn) nextBtn.disabled = page === 4;

    if (page === 1) this._loadBudgetView();
    if (page === 2) {
      this._loadAlertsView();
      this._loadBudgetOverview();
    }
    if (page === 3) this._loadBudgetManageView();
    if (page === 4) this._loadBudgetGroupsView();
  }

  _goToExpensesFlowPage(page) {
    page = Math.min(2, Math.max(1, page));
    this.currentExpensesFlowPage = page;

    document.querySelectorAll(".expenses-flow-page").forEach((el, idx) => {
      el.classList.toggle("hidden", idx + 1 !== page);
    });
    document.querySelectorAll(".expenses-flow-page-dot").forEach((btn) => {
      btn.classList.toggle("active", parseInt(btn.dataset.expensesFlowPage, 10) === page);
    });
    const indicator = document.getElementById("expenses-flow-page-indicator");
    if (indicator) indicator.textContent = `Página ${page} de 2`;
    const prevBtn = document.getElementById("expenses-flow-prev-btn");
    const nextBtn = document.getElementById("expenses-flow-next-btn");
    if (prevBtn) prevBtn.disabled = page === 1;
    if (nextBtn) nextBtn.disabled = page === 2;

    if (page === 1) this._loadExpensesView();
  }

  // ---------- Registrar Despesa ----------

  async _loadExpensesView() {
    const select = document.getElementById("expense-category");
    if (select) {
      const categories = await Api.listCategories();
      const previous = select.value;
      select.innerHTML = categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
      if (previous && categories.some((c) => c.id === previous)) select.value = previous;

      if (!this.expenseCategorySelectBound) {
        this.expenseCategorySelectBound = true;
        select.addEventListener("change", () => this._refreshExpenseCategoryBudgetInfo());
      }
    }

    const dateInput = document.getElementById("expense-date");
    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

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
  // js/api.js) indica que veio de orcamento_agent/mp_expenses.py, via
  // Access Token. Despesas antigas, geradas antes desse campo existir (ou
  // com origem desconhecida), mostram o selo genérico de sempre.
  _mercadoPagoRowBadgeHtml(e) {
    if (!e.generated_by_mercado_pago) return "";
    const origem =
      e.generated_by_mercado_pago_source === "api"
        ? { label: "Mercado Pago (API)", title: "Gerada automaticamente a partir de um pagamento real no Mercado Pago via API (orcamento_agent/mp_expenses.py)." }
        : { label: "Mercado Pago", title: "Gerada automaticamente a partir de um pagamento real no Mercado Pago (orcamento_agent/mp_expenses.py)." };
    return ` <span class="badge mp" title="${origem.title}">${origem.label}</span>`;
  }

  _expenseTransactionNumberHtml(e) {
    const txn = String(e.transaction_number || "").trim();
    if (!txn) return "";
    return `<p class="small-muted" style="margin:4px 0 0;font-size:12px;">Nº transação: ${txn}</p>`;
  }

  async _refreshExpenseTable() {
    const expenses = await Api.listExpenses();
    this.expensesById = new Map(expenses.map((e) => [e.id, e]));
    const tbody = document.getElementById("expenses-tbody");
    tbody.innerHTML = expenses
      .map(
        (e) => `
        <tr>
          <td>${e.date}</td>
          <td>${e.category_name || "-"}</td>
          <td>${e.description || ""}${e.is_extra ? ' <span class="badge premium" title="Despesa extra (fora do limite diário do plano Free)">extra</span>' : ""}${this._mercadoPagoRowBadgeHtml(e)}${this._expenseTransactionNumberHtml(e)}</td>
          <td>R$ ${e.amount.toFixed(2)}</td>
          <td class="actions-cell">
            <button class="secondary" onclick="editExpense('${e.id}')">Alterar</button>
            <button class="secondary" onclick="removeExpense('${e.id}')">Excluir</button>
          </td>
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

  async editExpense(id) {
    const expense = (this.expensesById && this.expensesById.get(id)) || (await Api.listExpenses()).find((e) => e.id === id);
    if (!expense) throw new Error("Despesa não encontrada");

    const date = window.prompt("Data (AAAA-MM-DD):", expense.date || "");
    if (date === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date).trim())) throw new Error("Data inválida. Use AAAA-MM-DD.");

    const description = window.prompt("Descrição:", expense.description || "");
    if (description === null) return;

    const amountRaw = window.prompt("Valor (R$):", String(expense.amount || ""));
    if (amountRaw === null) return;
    const amount = Number(String(amountRaw).replace(",", "."));
    if (!isFinite(amount) || amount <= 0) throw new Error("Valor inválido.");

    const categoryRaw = window.prompt("Categoria (nome):", expense.category_name || "");
    if (categoryRaw === null) return;
    const categoryName = String(categoryRaw).trim();

    let categoryId = null;
    if (categoryName) {
      const categories = await Api.listCategories();
      const key = categoryName.toLowerCase();
      let category = categories.find((c) => String(c.name || "").trim().toLowerCase() === key);
      if (!category) {
        await Api.addCategory(categoryName);
        category = (await Api.listCategories()).find((c) => String(c.name || "").trim().toLowerCase() === key);
      }
      categoryId = category ? category.id : null;
    }

    await Api.updateExpense(id, {
      amount,
      date: String(date).trim(),
      description: String(description).trim(),
      category_id: categoryId,
    });

    await this._loadExpensesView();
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
        const result = await Api.addExpense({
          amount,
          date,
          description,
          category_id,
          transaction_number: null,
        });
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
            manualTxnNumber: analysis ? analysis.manualTxnNumber : null,
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

  _renderPixKeyFallback(qrEl, payload) {
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

  async _handlePixKeyPaymentFormSubmit(e) {
    e.preventDefault();
    const errorBox = document.getElementById("pix-key-payment-error");
    const resultBox = document.getElementById("pix-key-payment-result");
    const qrEl = document.getElementById("pix-key-qrcode");
    const codeEl = document.getElementById("pix-key-copy-code");
    if (errorBox) errorBox.classList.add("hidden");

    const amount = Number(document.getElementById("pix-key-amount").value);
    const date = String(document.getElementById("pix-key-date").value || "").trim();
    const key = String(document.getElementById("pix-key-value").value || "").trim();
    const merchantName = String(document.getElementById("pix-key-merchant-name").value || "").trim();
    const merchantCity = String(document.getElementById("pix-key-merchant-city").value || "").trim();
    const description = String(document.getElementById("pix-key-description").value || "").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      if (errorBox) {
        errorBox.textContent = "Informe um valor válido para a despesa.";
        errorBox.classList.remove("hidden");
      }
      return;
    }

    try {
      const payload = Pix.buildPayload({
        key,
        name: merchantName,
        city: merchantCity,
        amount,
        description: description || `Despesa ${date || new Date().toISOString().slice(0, 10)}`,
        txid: Pix.generateTxid("PGTO"),
      });
      if (codeEl) codeEl.textContent = payload;
      if (resultBox) resultBox.classList.remove("hidden");
      if (qrEl) {
        qrEl.innerHTML = "";
        try {
          if (window.QRCode) {
            new QRCode(qrEl, { text: payload, width: 142, height: 142, correctLevel: QRCode.CorrectLevel.M });
          } else {
            this._renderPixKeyFallback(qrEl, payload);
          }
        } catch (_err) {
          this._renderPixKeyFallback(qrEl, payload);
        }
      }
    } catch (err) {
      if (errorBox) {
        errorBox.textContent = (err && err.message) || "Não foi possível gerar o pagamento Pix.";
        errorBox.classList.remove("hidden");
      }
      if (resultBox) resultBox.classList.add("hidden");
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

  _formatFeedDate(isoDate) {
    const dt = new Date(isoDate || "");
    if (isNaN(dt.getTime())) return "Data indisponível";
    return `${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR").slice(0, 5)}`;
  }

  _renderFeedEmptyState(box, message) {
    box.innerHTML = "";
    const empty = document.createElement("p");
    empty.className = "small-muted";
    empty.textContent = message;
    box.appendChild(empty);
  }

  async _loadFeedView() {
    const box = document.getElementById("feed-events");
    const refreshBtn = document.getElementById("feed-refresh-btn");
    if (!box) return;

    if (!this.feedBound && refreshBtn) {
      this.feedBound = true;
      refreshBtn.addEventListener("click", () => this._loadFeedView());
    }

    this._renderFeedEmptyState(box, "Carregando feed...");
    const events = [];
    try {
      const [expenses, payments] = await Promise.all([Api.listExpenses(true), Api.listPayments(true)]);

      expenses.forEach((expense) => {
        events.push({
          type: "expense",
          date: expense.created_at || expense.date,
          amount: Number(expense.amount) || 0,
          title: `Despesa · ${expense.category_name || "Sem categoria"}`,
          subtitle: `${this._formatFeedDate(expense.created_at || expense.date)} · ${expense.description || "Sem descrição"}`,
        });
      });

      payments.forEach((payment) => {
        const label =
          payment.type === "plano"
            ? `Pagamento de plano · ${payment.plan === "premium" ? "Premium" : payment.plan || "Plano"}`
            : "Pagamento de despesa extra";
        events.push({
          type: "payment",
          date: payment.date,
          amount: Number(payment.amount) || 0,
          title: label,
          subtitle: `${this._formatFeedDate(payment.date)} · txid ${payment.txid || "-"}`,
        });
      });
    } catch (_err) {
      this._renderFeedEmptyState(box, "Não foi possível carregar o feed agora.");
      return;
    }

    events.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    if (!events.length) {
      this._renderFeedEmptyState(box, "Nenhuma movimentação encontrada ainda.");
      return;
    }

    box.innerHTML = "";
    events.forEach((event) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.padding = "8px 0";
      row.style.borderBottom = "1px solid var(--border)";

      const left = document.createElement("div");
      const title = document.createElement("p");
      title.style.margin = "0";
      title.style.fontSize = "14px";
      title.textContent = event.title;
      const subtitle = document.createElement("p");
      subtitle.className = "small-muted";
      subtitle.style.margin = "2px 0 0";
      subtitle.textContent = event.subtitle;
      left.appendChild(title);
      left.appendChild(subtitle);

      const amount = document.createElement("strong");
      amount.style.color = event.type === "payment" ? "var(--success)" : "var(--danger)";
      amount.textContent = `${event.type === "payment" ? "+" : "-"}R$ ${event.amount.toFixed(2)}`;

      row.appendChild(left);
      row.appendChild(amount);
      box.appendChild(row);
    });
  }

  async _loadReportsView() {
    const monthly = await Api.monthlyReport();
    const byCategory = await Api.categoryReport();
    const alertData = await Api.getAlerts();

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

    const percentageEl = document.getElementById("datascience-percentage");
    const decisionEl = document.getElementById("datascience-decision-text");
    const box = document.getElementById("datascience-decision-box");
    if (percentageEl && decisionEl && box) {
      const limit = Number(alertData.limit || 0);
      const total = Number(alertData.total || 0);
      const percent = limit > 0 ? Math.round((total / limit) * 100) : 0;
      percentageEl.textContent = `${percent}%`;
      if (limit <= 0) {
        box.className = "alert-warn";
        decisionEl.textContent = " — Defina um orçamento mensal para liberar a tomada de decisão por porcentagem.";
      } else if (percent >= 100) {
        box.className = "alert-warn";
        decisionEl.textContent = " — Nível crítico: contenha gastos imediatamente.";
      } else if (percent >= 80) {
        box.className = "alert-warn";
        decisionEl.textContent = " — Nível de atenção: revise despesas não essenciais.";
      } else {
        box.className = "alert-ok";
        decisionEl.textContent = " — Nível saudável: mantenha a estratégia atual.";
      }
    }
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
    const limitInput = document.getElementById("budget-limit");
    const monthInput = document.getElementById("budget-month");
    if (!limitInput || !monthInput) return;
    if (!limitInput.reportValidity() || !monthInput.reportValidity()) return;
    const limit_value = parseFloat(limitInput.value);
    const month = monthInput.value;
    await Api.setBudget({ limit_value, month });
    await this._loadAlertsView();
  }

  // ---------- Previsto x Realizado por categoria (fecha o fluxo: dados
  // importados na Página 1 + despesas reais registradas no Menu Despesas) ----------

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

  async _loadBudgetManageView() {
    const monthInput = document.getElementById("budget-manage-month");
    const refreshBtn = document.getElementById("budget-manage-refresh-btn");
    const tbody = document.getElementById("budget-manage-tbody");
    if (!monthInput || !tbody) return;

    if (!this.budgetManageBound) {
      this.budgetManageBound = true;
      monthInput.addEventListener("change", () => this._renderBudgetManageTable(monthInput.value));
      if (refreshBtn) refreshBtn.addEventListener("click", () => this._renderBudgetManageTable(monthInput.value));
      tbody.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest("button[data-budget-action]");
        if (!btn) return;
        const id = btn.dataset.budgetId;
        if (!id) return;
        if (btn.dataset.budgetAction === "save") this._saveCategoryBudgetFromRow(id);
        if (btn.dataset.budgetAction === "delete") this._deleteCategoryBudgetFromRow(id);
      });
    }

    if (!monthInput.value) monthInput.value = new Date().toISOString().slice(0, 7);
    await this._renderBudgetManageTable(monthInput.value);
  }

  async _renderBudgetManageTable(month) {
    const status = document.getElementById("budget-manage-status");
    const tbody = document.getElementById("budget-manage-tbody");
    if (!tbody) return;
    if (!month) {
      if (status) status.textContent = "Informe o mês.";
      return;
    }
    const rows = await Api.listCategoryBudgets(month);
    if (status) status.textContent = `${rows.length} orçamento(s) encontrado(s) para ${month}.`;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="3">Nenhum orçamento por categoria neste mês.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map(
        (r) => `
        <tr>
          <td>${r.category_name || "Sem categoria"}</td>
          <td><input type="number" min="0" step="0.01" data-budget-previsto="${r.id}" data-category-id="${r.category_id}" value="${Number(r.previsto || 0).toFixed(2)}" required /></td>
          <td>
            <button type="button" class="secondary" data-budget-action="save" data-budget-id="${r.id}">Alterar</button>
            <button type="button" class="secondary" data-budget-action="delete" data-budget-id="${r.id}">Excluir</button>
          </td>
        </tr>`
      )
      .join("");
  }

  async _saveCategoryBudgetFromRow(id) {
    const monthInput = document.getElementById("budget-manage-month");
    const input = document.querySelector(`input[data-budget-previsto="${id}"]`);
    const status = document.getElementById("budget-manage-status");
    if (!input || !monthInput) return;
    if (!input.reportValidity() || !monthInput.reportValidity()) return;
    const previsto = parseFloat(input.value);
    const categoryId = input.dataset.categoryId;
    const month = monthInput.value;
    await Api.setCategoryBudget({ category_id: categoryId, month, previsto });
    if (status) status.textContent = "Orçamento atualizado.";
    await this._renderBudgetManageTable(month);
  }

  async _deleteCategoryBudgetFromRow(id) {
    const monthInput = document.getElementById("budget-manage-month");
    const status = document.getElementById("budget-manage-status");
    if (!monthInput) return;
    if (!confirm("Tem certeza que deseja excluir este orçamento?")) return;
    await Api.deleteCategoryBudget(id);
    if (status) status.textContent = "Orçamento excluído.";
    await this._renderBudgetManageTable(monthInput.value);
  }

  async _loadBudgetGroupsView() {
    const refreshBtn = document.getElementById("budget-groups-refresh-btn");
    if (!this.budgetGroupsBound) {
      this.budgetGroupsBound = true;
      if (refreshBtn) refreshBtn.addEventListener("click", () => this._renderBudgetGroupsTable());
    }
    await this._renderBudgetGroupsTable();
  }

  async _renderBudgetGroupsTable() {
    const tbody = document.getElementById("budget-groups-tbody");
    const status = document.getElementById("budget-groups-status");
    if (!tbody) return;
    const groups = await Api.listBudgetGroups();
    if (status) status.textContent = `${groups.length} grupo(s) criado(s) automaticamente.`;
    if (!groups.length) {
      tbody.innerHTML = '<tr><td colspan="3">Nenhum grupo criado ainda.</td></tr>';
      return;
    }
    tbody.innerHTML = groups
      .map(
        (g) => `
        <tr>
          <td>${g.name || "-"}</td>
          <td>${g.budget_category_name || "-"}</td>
          <td>${g.expense_category_name || "-"}</td>
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
        `. Vá para o menu Despesas para registrar gastos e para a Página 2 de Orçamento para ver a comparação.`;
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
    const largoIds = ["layout-col-categoria-larga", "layout-month-row", "layout-subheader-row"];
    const longoIds = ["layout-header-row", "layout-col-categoria", "layout-col-mes", "layout-col-previsto", "layout-col-realizado"];
    largoIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.required = format === "largo";
    });
    longoIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.required = format === "longo";
    });
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
    const requiredByFormat = format === "largo"
      ? ["layout-col-categoria-larga", "layout-month-row", "layout-subheader-row"]
      : ["layout-header-row", "layout-col-categoria", "layout-col-mes", "layout-col-previsto", "layout-col-realizado"];
    const allValid = requiredByFormat.every((id) => {
      const el = document.getElementById(id);
      return !!el && el.reportValidity();
    });
    if (!allValid) return;

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
          manualTxnNumber: analysis ? analysis.manualTxnNumber : null,
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

  async _recordPayment({ type, plan, amount, txid, verifiedByAI, aiClassification, manualTxnNumber }) {
    await Api.addPayment({ type, plan, amount, txid, verifiedByAI, aiClassification, manualTxnNumber });
  }

  // Status da Nota Fiscal de Serviço (NFS-e) real deste pagamento -- gerada
  // fora do navegador por orcamento_agent/nfse_issuer.py (nunca no site
  // público: o token do provedor de emissão fiscal nunca pode ir para o
  // front-end, mesmo cuidado do Access Token do Mercado Pago). Este método
  // só EXIBE o que o script já gravou no pagamento (nfseStatus e afins);
  // não dispara emissão nenhuma a partir do painel.
  _nfseStatusHtml(p) {
    const status = p.nfseStatus;
    if (!status) {
      return '<span class="small-muted">Nota fiscal: ainda não processada.</span>';
    }
    if (status === "emitida") {
      const numero = p.nfseNumero ? ` nº ${p.nfseNumero}` : "";
      const link = p.nfsePdfUrl
        ? ` · <a href="${p.nfsePdfUrl}" target="_blank" rel="noopener">ver PDF</a>`
        : "";
      return `<span style="color:var(--success);">✓ Nota fiscal emitida${numero}${link}</span>`;
    }
    if (status === "emitindo") {
      return '<span style="color:#b45309;">⏳ Nota fiscal em processamento…</span>';
    }
    if (status === "aguardando_documento_tomador" || status === "aguardando_dados_tomador") {
      return '<span style="color:#b45309;">⚠ Nota fiscal pendente: cadastre seu CPF/CNPJ em Configurações.</span>';
    }
    if (status === "erro") {
      const detalhe = p.nfseErro ? ` (${String(p.nfseErro).slice(0, 120)})` : "";
      return `<span style="color:var(--danger);">✗ Erro ao emitir nota fiscal${detalhe}</span>`;
    }
    return `<span class="small-muted">Nota fiscal: ${status}</span>`;
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
        // Quando a leitura automática do comprovante não foi possível, o
        // usuário informou o número da transação manualmente (ver
        // ManualTransactionModal) — mostra isso aqui para dar transparência
        // de que a validação, nesse caso, foi manual.
        const manualTxnLine = p.manualTxnNumber
          ? `<p class="small-muted" style="margin:2px 0 0;font-size:12px;">Nº da transação informado pelo usuário: ${p.manualTxnNumber}</p>`
          : "";
        return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
          <div>
            <p style="margin:0;font-size:14px;">${label}</p>
            <p class="small-muted" style="margin:2px 0 0;">${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR").slice(0, 5)} · txid ${p.txid || "-"}</p>
            <p style="margin:2px 0 0;font-size:12px;">${badge}</p>
            ${manualTxnLine}
            <p style="margin:2px 0 0;font-size:12px;">${this._nfseStatusHtml(p)}</p>
          </div>
          <strong style="color:var(--success);">R$ ${p.amount.toFixed(2)}</strong>
        </div>`;
      })
      .join("");
  }

  // ---------- Segurança ----------
  //
  // Conteúdo baseado no material de referência público do W3Schools Cyber
  // Security Tutorial (https://www.w3schools.com/cybersecurity/ — CIA
  // Triad, Passwords, Web Applications/Web Application Attacks, Network
  // Attacks) e nos controles de segurança de fato implementados neste app
  // (ver js/oauth.js, js/crypto-utils.js, meta CSP em dashboard.html).

  static get SECURITY_CONTROLS() {
    return [
      { title: "Senha nunca em texto puro", detail: "Hash PBKDF2 (100.000 iterações, SHA-256) + salt aleatório por usuário — mesmo o próprio banco de dados nunca guarda a senha real (js/crypto-utils.js)." },
      { title: "OAuth 2.0 próprio (Authorization Code + PKCE)", detail: "Login emite tokens JWT (HS256) assinados: access_token de 1h e refresh_token de 30 dias, com rotação e revogação (js/oauth.js)." },
      { title: "Verificação criptográfica da sessão", detail: "Assinatura do token é reconferida (crypto.subtle.verify, comparação em tempo constante) e a expiração é checada a cada carregamento do painel." },
      { title: "Bloqueio após tentativas de login erradas", detail: "5 senhas erradas seguidas para o mesmo e-mail travam novas tentativas por 60s — mitigação de força bruta (W3Schools Cyber Security > Passwords)." },
      { title: "HTTPS obrigatório", detail: "Hospedado no GitHub Pages: todo tráfego (login, dados) é cifrado em trânsito (TLS)." },
      { title: "Content-Security-Policy", detail: "Meta tag CSP restringe de quais domínios o navegador pode carregar script/estilo/imagem/conexão (ver <head> deste documento)." },
      { title: "Isolamento por conta (tenant_id)", detail: "Toda consulta ao banco filtra pelo tenant_id da sessão — um usuário nunca lê dados de outra conta (js/api.js)." },
      { title: "Consentimento de cookies (Google Consent Mode)", detail: "Cookies de analytics/anúncios começam bloqueados (\"denied\") até o usuário autorizar na tela Privacidade." },
    ];
  }

  static get CIA_TRIAD() {
    return [
      { letter: "C", title: "Confidencialidade", detail: "Senha em hash (nunca reversível), tokens assinados, CSP e HTTPS impedem que dados sejam lidos por quem não deveria." },
      { letter: "I", title: "Integridade", detail: "Assinatura HMAC garante que ninguém alterou as claims de um token; merge de 3 vias (js/db.js) evita corromper dados entre dispositivos." },
      { letter: "A", title: "Disponibilidade", detail: "Fallback automático para localStorage quando o Firestore está fora do ar — o app continua funcionando offline." },
    ];
  }

  static get SECURITY_THREATS() {
    return [
      { name: "Phishing / Engenharia social", what: "Mensagens fingindo ser o Fintech Spacecworp para roubar sua senha.", mitigation: "Nunca pedimos sua senha por e-mail/WhatsApp — confira sempre a URL antes de entrar." },
      { name: "Força bruta de senha", what: "Tentar adivinhar sua senha por tentativa e erro.", mitigation: "Bloqueio temporário após 5 tentativas + hash PBKDF2 (100.000 iterações) dificultam ataque offline." },
      { name: "Ataques a aplicações web (XSS/injeção)", what: "Injetar código ou comandos maliciosos através de campos de formulário.", mitigation: "Sem SQL (Firestore/localStorage), escaping ao exibir dados do usuário, e Content-Security-Policy." },
      { name: "Man-in-the-middle", what: "Interceptar dados trafegando entre você e o servidor.", mitigation: "HTTPS/TLS obrigatório em toda comunicação com Firebase e com a página." },
      { name: "Roubo/vazamento de token de sessão", what: "Uso indevido de uma sessão logada roubada.", mitigation: "Tokens de curta duração (1h), revogação no logout e rotação do refresh_token." },
      { name: "Vazamento de dados / Dark Web", what: "Credenciais vazadas sendo revendidas ou reutilizadas em outros sites.", mitigation: "Coletamos o mínimo necessário e nunca guardamos a senha em formato reversível." },
    ];
  }

  static get ISO_STANDARDS() {
    return [
      { code: "ISO/IEC 27001", name: "Gestão de Segurança da Informação", relevance: "Referência para os controles de segurança (senha, tokens, sessão) desta tela." },
      { code: "ISO/IEC 27002", name: "Código de práticas de segurança da informação", relevance: "Orienta os controles técnicos específicos adotados (política de senha, criptografia)." },
      { code: "ISO/IEC 27017", name: "Segurança da informação em nuvem", relevance: "Dados hospedados no Firebase/Firestore (nuvem)." },
      { code: "ISO/IEC 27018", name: "Proteção de dados pessoais (PII) em nuvem pública", relevance: "Base para como tratamos dados pessoais armazenados na nuvem." },
      { code: "ISO/IEC 27701", name: "Gestão de privacidade da informação", relevance: "Estrutura usada na tela Privacidade (extensão de privacidade da 27001)." },
      { code: "ISO/IEC 29100", name: "Framework de privacidade", relevance: "Princípios de privacidade (minimização, finalidade, consentimento) da tela Privacidade." },
      { code: "ISO/IEC 25010", name: "Qualidade de software (SQuaRE)", relevance: "Características de qualidade (segurança, confiabilidade, usabilidade) que guiam o desenvolvimento." },
      { code: "ISO 31000", name: "Gestão de riscos", relevance: "Avaliação de riscos como dependência de um único provedor de nuvem e ausência de backend próprio." },
      { code: "ISO 9001", name: "Gestão da qualidade", relevance: "Processos gerais da empresa desenvolvedora (SPACECWORP)." },
      { code: "ISO 20022", name: "Mensageria financeira", relevance: "Padrão usado no sistema financeiro brasileiro (Bacen/Pix) — o app processa pagamentos Pix." },
      { code: "ISO 8000", name: "Qualidade de dados", relevance: "Consistência dos dados financeiros (despesas, orçamento) armazenados." },
    ];
  }

  async _loadSecurityView() {
    if (!this.securityBound) {
      this.securityBound = true;

      document.getElementById("security-controls-list").innerHTML = DashboardController.SECURITY_CONTROLS.map(
        (c) => `<li><strong>${c.title}</strong> — ${c.detail}</li>`
      ).join("");

      document.getElementById("cia-triad-grid").innerHTML = DashboardController.CIA_TRIAD.map(
        (c) => `
        <div class="card cia-card">
          <div class="cia-letter">${c.letter}</div>
          <h4 class="mt-0 mb-4">${c.title}</h4>
          <p class="small-muted m-0">${c.detail}</p>
        </div>`
      ).join("");

      document.getElementById("security-threats-tbody").innerHTML = DashboardController.SECURITY_THREATS.map(
        (t) => `<tr><td><strong>${t.name}</strong></td><td>${t.what}</td><td>${t.mitigation}</td></tr>`
      ).join("");

      document.getElementById("iso-grid").innerHTML = DashboardController.ISO_STANDARDS.map(
        (i) => `
        <div class="iso-card">
          <span class="badge premium">${i.code}</span>
          <h4 class="mt-6 mb-4">${i.name}</h4>
          <p class="small-muted m-0">${i.relevance}</p>
        </div>`
      ).join("");

      const revokeBtn = document.getElementById("security-revoke-btn");
      if (revokeBtn) {
        revokeBtn.addEventListener("click", () => {
          Auth.clearToken();
          window.location.href = "login.html";
        });
      }
    }

    const box = document.getElementById("security-session-box");
    if (box) {
      try {
        const raw = Auth.getToken();
        const tokens = raw ? JSON.parse(raw) : null;
        const claims = tokens && tokens.access_token ? OAuth.decodeUnsafe(tokens.access_token) : null;
        if (claims) {
          const expiresAt = new Date(claims.exp * 1000);
          const scope = (claims.scope || []).join(", ") || "—";
          box.className = "alert-ok mb-14";
          box.innerHTML =
            `Token de acesso válido até <strong>${expiresAt.toLocaleString("pt-BR")}</strong>.<br/>` +
            `Escopo concedido (OAuth): <code>${scope}</code>.`;
        } else {
          box.className = "alert-warn mb-14";
          box.textContent = "Não foi possível ler a sessão OAuth atual.";
        }
      } catch (e) {
        box.className = "alert-warn mb-14";
        box.textContent = "Não foi possível ler a sessão OAuth atual.";
      }
    }
  }

  // ---------- Privacidade (LGPD, Lei 13.709/2018) ----------

  static get PRIVACY_DATA_ROWS() {
    return [
      { data: "Nome e e-mail", finalidade: "Criar sua conta, identificar você e permitir o login.", base: "Execução de contrato (art. 7º, V)" },
      { data: "Senha (armazenada como hash, nunca em texto puro)", finalidade: "Autenticação.", base: "Execução de contrato (art. 7º, V)" },
      { data: "Despesas, categorias e orçamentos", finalidade: "Fornecer o serviço de controle financeiro.", base: "Execução de contrato (art. 7º, V)" },
      { data: "Comprovante de Pix (imagem ou PDF, lido localmente no navegador)", finalidade: "Confirmar pagamentos.", base: "Execução de contrato (art. 7º, V)" },
      { data: "Número da transação informado manualmente (quando a leitura automática do comprovante falha)", finalidade: "Permitir a confirmação do pagamento sem depender da IA de OCR.", base: "Execução de contrato (art. 7º, V)" },
      { data: "Cookies do Google Ads / Tag Manager", finalidade: "Medir audiência e conversões de anúncios.", base: "Consentimento (art. 7º, I) — desativado por padrão" },
    ];
  }

  static get PRIVACY_RIGHTS() {
    return [
      "Confirmação da existência de tratamento e acesso aos seus dados.",
      "Correção de dados incompletos, inexatos ou desatualizados (tela Configurações).",
      "Anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em excesso.",
      "Portabilidade dos dados a outro fornecedor, mediante requisição (botão \"Baixar meus dados\" abaixo).",
      "Eliminação dos dados tratados com consentimento (botão \"Excluir minha conta\" abaixo).",
      "Revogação do consentimento de cookies de analytics/anúncios, a qualquer momento.",
      "Informação sobre com quem seus dados são compartilhados — apenas Firebase/Google (infraestrutura) e, se você consentir, Google Ads/Tag Manager.",
    ];
  }

  async _loadPrivacyView() {
    if (!this.privacyBound) {
      this.privacyBound = true;

      const profile = await Api.getCompanyProfile();
      document.getElementById("privacy-controller-box").innerHTML =
        `<strong>${profile.razao_social}</strong> (${profile.nome_fantasia}) — CNPJ ${profile.cnpj}. ` +
        `${profile.endereco.logradouro}, ${profile.endereco.bairro}, ${profile.endereco.cidade}/${profile.endereco.uf} — CEP ${profile.endereco.cep}. ` +
        `Contato para solicitações de privacidade (LGPD): <a href="mailto:${profile.contato_privacidade}">${profile.contato_privacidade}</a>.`;

      document.getElementById("privacy-data-tbody").innerHTML = DashboardController.PRIVACY_DATA_ROWS.map(
        (r) => `<tr><td>${r.data}</td><td>${r.finalidade}</td><td>${r.base}</td></tr>`
      ).join("");

      document.getElementById("privacy-rights-list").innerHTML = DashboardController.PRIVACY_RIGHTS.map(
        (r) => `<li>${r}</li>`
      ).join("");

      const consentInput = document.getElementById("privacy-marketing-consent");
      const consentStatus = document.getElementById("privacy-consent-status");
      if (consentInput) {
        consentInput.addEventListener("change", async () => {
          const granted = consentInput.checked;
          await Api.setPrivacyConsent({ marketing: granted });
          if (typeof gtag === "function") {
            gtag("consent", "update", {
              ad_storage: granted ? "granted" : "denied",
              analytics_storage: granted ? "granted" : "denied",
              ad_user_data: granted ? "granted" : "denied",
              ad_personalization: granted ? "granted" : "denied",
            });
          }
          if (consentStatus) {
            consentStatus.textContent = granted
              ? "Cookies de analytics/anúncios autorizados."
              : "Cookies de analytics/anúncios bloqueados.";
          }
        });
      }

      const exportBtn = document.getElementById("privacy-export-btn");
      if (exportBtn) {
        exportBtn.addEventListener("click", async () => {
          const data = await Api.exportMyData();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `meus-dados-fintech-spacecworp-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        });
      }

      const deleteBtn = document.getElementById("privacy-delete-btn");
      const deleteError = document.getElementById("privacy-delete-error");
      if (deleteBtn) {
        deleteBtn.addEventListener("click", async () => {
          deleteError.classList.add("hidden");
          const confirmed = window.confirm(
            "Tem certeza? Isso vai excluir permanentemente seu usuário e, se você for o único membro da conta, todos os dados dela (despesas, orçamentos, pagamentos). Esta ação não pode ser desfeita."
          );
          if (!confirmed) return;
          try {
            await Api.deleteAccount();
            window.location.href = "login.html";
          } catch (err) {
            deleteError.textContent = err.message;
            deleteError.classList.remove("hidden");
          }
        });
      }
    }

    try {
      const consent = await Api.getPrivacyConsent();
      const consentInput = document.getElementById("privacy-marketing-consent");
      if (consentInput) consentInput.checked = !!consent.marketing;
    } catch (e) {
      // sessão pode ter acabado de carregar — ignora silenciosamente
    }
  }

  // ---------- Configurações ----------

  async _loadSettingsView() {
    if (!this.settingsBound) {
      this.settingsBound = true;

      const profile = await Api.getCompanyProfile();
      document.getElementById("settings-company-box").innerHTML = `
        <div><span class="small-muted">Razão social</span><p class="m-0 fw-600">${profile.razao_social}</p></div>
        <div><span class="small-muted">Nome fantasia</span><p class="m-0 fw-600">${profile.nome_fantasia}</p></div>
        <div><span class="small-muted">CNPJ</span><p class="m-0 fw-600">${profile.cnpj}</p></div>
        <div><span class="small-muted">Porte</span><p class="m-0 fw-600">${profile.porte}</p></div>
        <div><span class="small-muted">Inscrição Municipal (CCM)</span><p class="m-0 fw-600">${profile.inscricao_municipal_ccm}</p></div>
        <div><span class="small-muted">Inscrição Estadual (Jucesp)</span><p class="m-0 fw-600">${profile.inscricao_estadual_jucesp}</p></div>
        <div><span class="small-muted">CNAE principal</span><p class="m-0 fw-600">${profile.cnae_principal}</p></div>
        <div><span class="small-muted">Endereço</span><p class="m-0 fw-600">${profile.endereco.logradouro}, ${profile.endereco.bairro}, ${profile.endereco.cidade}/${profile.endereco.uf} — CEP ${profile.endereco.cep}</p></div>
        <div><span class="small-muted">Telefone</span><p class="m-0 fw-600">${profile.telefone}</p></div>
        <div><span class="small-muted">Início de atividade</span><p class="m-0 fw-600">${profile.inicio_atividade}</p></div>
        <div><span class="small-muted">Alvará de Funcionamento</span><p class="m-0 fw-600">Nº processo ${profile.alvara.numero_processo} — válido até ${profile.alvara.valido_ate}</p></div>
        <div class="company-profile-full"><span class="small-muted">Atividades registradas</span><p class="m-0">${profile.atividades.join("; ")}.</p></div>
      `;
    }

    document.getElementById("settings-profile-name").value = this.currentUser.name;
    document.getElementById("settings-profile-email").value = this.currentUser.email || "";
    const docInput = document.getElementById("settings-profile-document");
    if (docInput) docInput.value = this.currentUser.tax_document || "";
  }

  async _handleProfileFormSubmit(e) {
    e.preventDefault();
    const errorBox = document.getElementById("settings-profile-error");
    const successBox = document.getElementById("settings-profile-success");
    errorBox.classList.add("hidden");
    successBox.classList.add("hidden");

    const name = document.getElementById("settings-profile-name").value.trim();
    const document_ = document.getElementById("settings-profile-document").value.trim();
    try {
      const updated = await Api.updateProfile({ name, document: document_ });
      this.currentUser.name = updated.name;
      this.currentUser.tax_document = updated.tax_document;
      const userNameEl = document.getElementById("user-name");
      if (userNameEl) userNameEl.textContent = updated.name;
      successBox.textContent = "Perfil atualizado!";
      successBox.classList.remove("hidden");
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove("hidden");
    }
  }

  async _handlePasswordFormSubmit(e) {
    e.preventDefault();
    const errorBox = document.getElementById("settings-password-error");
    const successBox = document.getElementById("settings-password-success");
    errorBox.classList.add("hidden");
    successBox.classList.add("hidden");

    const currentPassword = document.getElementById("settings-current-password").value;
    const newPassword = document.getElementById("settings-new-password").value;

    try {
      await Api.changePassword({ currentPassword, newPassword });
      document.getElementById("settings-password-form").reset();
      successBox.textContent = "Senha alterada!";
      successBox.classList.remove("hidden");
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove("hidden");
    }
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

function editExpense(id) {
  return dashboardController && dashboardController.editExpense(id);
}

function selectPlan(planKey) {
  return dashboardController && dashboardController.selectPlan(planKey);
}
