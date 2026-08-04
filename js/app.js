/* =============================================================
   Fintech Inteligente — js/app.js
   Camada de interação do dashboard estático (index.html):
   - Menu (sidebar + nav inferior) operacional, trocando de "view"
   - Formulário/modal "Nova Despesa" totalmente integrado ao estado
     do dashboard (KPIs, categorias, gráfico, alertas, tabela)
   - Persistência em localStorage entre sessões
   ============================================================= */

(function () {
  'use strict';

  /* -----------------------------------------------------------
     1. CONFIGURAÇÃO / ESTADO
     ----------------------------------------------------------- */

  var STORAGE_KEY = 'fintech_dashboard_state_v2';

  var CATEGORY_CONFIG = {
    alimentacao: { label: 'Alimentação', icon: '🛒', color: 'red' },
    moradia: { label: 'Moradia', icon: '🏠', color: 'blue' },
    transporte: { label: 'Transporte', icon: '🚌', color: 'purple' },
    lazer: { label: 'Lazer', icon: '🎬', color: 'amber' },
    outros: { label: 'Outros', icon: '📦', color: 'gray' }
  };

  // Orçamento planejado por categoria (usado para disparar alertas)
  var CATEGORY_BUDGETS = {
    alimentacao: 1000,
    moradia: 1000,
    transporte: 500,
    lazer: 400,
    outros: 400
  };

  var VIEW_SECTIONS = {
    dashboard: ['alerts-section', 'kpis-section', 'reports-section', 'expenses-section'],
    despesas: ['kpis-section', 'expenses-section'],
    relatorios: ['reports-section'],
    alertas: ['alerts-section'],
    produtos: ['products-section'],
    plano: ['plans-section']
  };

  var ALL_SECTIONS = [
    'locked-section',
    'alerts-section',
    'kpis-section',
    'reports-section',
    'expenses-section',
    'products-section',
    'plans-section'
  ];

  // Views que só podem ser usadas com o usuário logado. "produtos" e "plano"
  // ficam visíveis mesmo deslogado (conteúdo institucional/comercial), mas
  // qualquer ação que altere dados (nova despesa, orçamento, trocar de
  // plano etc.) passa por requireLogin() antes de executar.
  var GATED_VIEWS = ['dashboard', 'despesas', 'relatorios', 'alertas'];

  var VIEW_TITLES = {
    dashboard: ['Dashboard', 'Bem-vindo(a), Usuário!'],
    despesas: ['Despesas', 'Todas as suas despesas registradas'],
    relatorios: ['Relatórios', 'Gastos mensais e distribuição por categoria'],
    alertas: ['Alertas', 'Avisos sobre o seu orçamento'],
    produtos: ['Produtos e Serviços', 'Soluções sob medida em desenvolvimento de software (CNAE 62.01-5-01)'],
    plano: ['Plano', 'Escolha o plano ideal para o seu uso']
  };

  // ---------- Planos (Free / Premium) ----------
  //
  // Free: acesso completo ao sistema, limitado a 6 despesas/dia. Cada
  // despesa que exceder o limite diário exige um pagamento real via Pix
  // (QR Code/copia-e-cola gerado com a chave Pix da SPACECWORP) de
  // R$ 5,00/unidade antes de ser registrada — ver js/pix.js e
  // openPixPayment().
  // Premium: acesso completo ao sistema, despesas ilimitadas, R$ 19,99/mês
  // (também pago via Pix real).
  var PLANS = {
    free: { label: 'Free', price_month: 0, max_expenses_day: 6, overage_price: 5.0 },
    premium: { label: 'Premium', price_month: 19.99, max_expenses_day: Infinity, overage_price: 0 }
  };

  // Chave Pix real da SPACECWORP (a mesma usada na tela "Produtos e Serviços").
  var PIX_MERCHANT = { key: '62904267000160', name: 'SPACECWORP', city: 'OSASCO' };
  var PAYMENTS_KEY = 'fintech_payments_v1';

  function defaultState() {
    return {
      view: 'dashboard',
      saldo: 0,
      orcamentoTotal: 3500.0,
      gastosMes: 0,
      lancamentosCount: 0,
      novosNestaSessao: 0,
      expenses: [],
      categoryTotals: {
        alimentacao: 0,
        moradia: 0,
        transporte: 0,
        lazer: 0,
        outros: 0
      },
      alerts: []
    };
  }

  var state = loadState();

  function loadState() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.expenses) || !parsed.categoryTotals) {
        return defaultState();
      }
      // garante que campos novos existam mesmo se o storage for de uma versão antiga
      var base = defaultState();
      return Object.assign(base, parsed, { view: 'dashboard' });
    } catch (err) {
      return defaultState();
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      /* localStorage indisponível (modo privado, etc.) — segue sem persistir */
    }
  }

  /* -----------------------------------------------------------
     2. HELPERS
     ----------------------------------------------------------- */

  function formatMoney(value) {
    var n = typeof value === 'number' && !isNaN(value) ? value : 0;
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Math.abs(n));
  }

  function formatDateBR(isoDate) {
    var parts = (isoDate || '').split('-');
    if (parts.length !== 3) return isoDate || '';
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function categoryTotalSum() {
    var sum = 0;
    Object.keys(state.categoryTotals).forEach(function (k) {
      sum += Number(state.categoryTotals[k]) || 0;
    });
    return sum;
  }

  /* -----------------------------------------------------------
     3. RENDERIZAÇÃO
     ----------------------------------------------------------- */

  function renderMoneySplit(el, value) {
    if (!el) return;
    var negative = value < 0;
    var formatted = formatMoney(value);
    var pieces = formatted.split(',');
    var intPart = pieces[0];
    var decPart = pieces[1] || '00';
    el.innerHTML =
      (negative ? '- ' : '') +
      'R$ ' +
      intPart +
      '<span class="text-base font-normal text-gray-500">,' +
      decPart +
      '</span>';
  }

  function renderKPIs() {
    renderMoneySplit(document.getElementById('kpi-saldo'), state.saldo);
    renderMoneySplit(document.getElementById('kpi-gastos'), state.gastosMes);
    renderMoneySplit(document.getElementById('kpi-orcamento-value'), state.orcamentoTotal);

    var saldoChangeEl = document.getElementById('kpi-saldo-change');
    if (saldoChangeEl) {
      saldoChangeEl.textContent =
        state.saldo > 0 ? '▲ saldo positivo' : state.saldo < 0 ? '▼ saldo negativo' : 'Nenhum registro ainda';
      saldoChangeEl.className =
        (state.saldo > 0 ? 'text-emerald-400' : state.saldo < 0 ? 'text-red-400' : 'text-gray-500') + ' text-xs mt-2';
    }

    var gastosChangeEl = document.getElementById('kpi-gastos-change');
    if (gastosChangeEl) {
      gastosChangeEl.textContent =
        state.gastosMes > 0 ? state.lancamentosCount + ' lançamento(s) neste mês' : 'Nenhuma despesa registrada ainda';
      gastosChangeEl.className = (state.gastosMes > 0 ? 'text-gray-400' : 'text-gray-500') + ' text-xs mt-2';
    }

    var pct = state.orcamentoTotal > 0 ? (state.gastosMes / state.orcamentoTotal) * 100 : 0;
    var pctRounded = Math.round(pct);
    var remaining = state.orcamentoTotal - state.gastosMes;

    var usedLabel = document.getElementById('kpi-orcamento-used-label');
    var remainingLabel = document.getElementById('kpi-orcamento-remaining');
    var bar = document.getElementById('kpi-orcamento-bar');

    if (usedLabel) usedLabel.textContent = pctRounded + '% usado';
    if (remainingLabel) {
      remainingLabel.textContent =
        remaining >= 0
          ? 'R$ ' + formatMoney(remaining) + ' restante'
          : 'R$ ' + formatMoney(remaining) + ' acima do orçamento';
    }
    if (bar) {
      bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
      bar.className =
        'h-1.5 rounded-full ' + (pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-400');
    }

    var countEl = document.getElementById('kpi-lancamentos-count');
    if (countEl) countEl.textContent = String(state.lancamentosCount);

    var subEl = document.getElementById('kpi-lancamentos-sub');
    if (subEl) {
      subEl.textContent =
        state.novosNestaSessao > 0 ? '+' + state.novosNestaSessao + ' nesta sessão' : '+5 esta semana';
    }
  }

  function renderCategories() {
    var total = categoryTotalSum() || 1;
    Object.keys(CATEGORY_CONFIG).forEach(function (cat) {
      var value = Number(state.categoryTotals[cat]) || 0;
      var pct = Math.min(100, (value / total) * 100);
      var valueEl = document.getElementById('cat-' + cat + '-value');
      var barEl = document.getElementById('cat-' + cat + '-bar');
      if (valueEl) valueEl.textContent = 'R$ ' + formatMoney(value);
      if (barEl) barEl.style.width = pct.toFixed(1) + '%';
    });
  }

  function renderChart() {
    var valueEl = document.getElementById('chart-jun-value');
    var barEl = document.getElementById('chart-jun-bar');
    var thousands = state.gastosMes / 1000;
    var heightPct = Math.max(6, Math.min(100, thousands * 22.8));
    if (barEl) barEl.style.height = heightPct.toFixed(0) + '%';
    if (valueEl) valueEl.textContent = thousands.toFixed(1).replace('.', ',') + 'k';
  }

  function buildExpenseRowHTML(exp) {
    var cfg = CATEGORY_CONFIG[exp.category] || CATEGORY_CONFIG.outros;
    var label = exp.labelOverride || cfg.label;
    var color = exp.colorOverride || cfg.color;
    var icon = exp.icon || cfg.icon;
    var dateBR = formatDateBR(exp.date);
    var shortDate = dateBR ? dateBR.slice(0, 5) : '';

    return (
      '<div class="expense-row grid md:grid-cols-12 items-center py-4 px-2 gap-2 rounded-xl hover:bg-gray-800/50 transition" data-id="' +
      escapeHtml(exp.id) +
      '">' +
      '<div class="md:col-span-5 flex items-center gap-3">' +
      '<div class="w-9 h-9 rounded-xl bg-' +
      color +
      '-500/10 flex items-center justify-center flex-shrink-0 text-base">' +
      icon +
      '</div>' +
      '<div>' +
      '<p class="text-sm font-medium text-white">' +
      escapeHtml(exp.desc) +
      '</p>' +
      '<p class="text-xs text-gray-500 md:hidden">' +
      escapeHtml(label) +
      ' · ' +
      shortDate +
      '</p>' +
      '</div>' +
      '</div>' +
      '<div class="hidden md:block md:col-span-2">' +
      '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-' +
      color +
      '-500/10 text-' +
      color +
      '-300">' +
      escapeHtml(label) +
      '</span>' +
      '</div>' +
      '<div class="hidden md:block md:col-span-2 text-sm text-gray-400">' +
      dateBR +
      '</div>' +
      '<div class="md:col-span-3 flex items-center justify-end gap-3 ml-auto md:ml-0">' +
      '<span class="text-sm font-semibold text-red-400">- R$ ' +
      formatMoney(exp.value) +
      '</span>' +
      '<button type="button" class="expense-delete w-6 h-6 flex items-center justify-center flex-shrink-0 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition" data-id="' +
      escapeHtml(exp.id) +
      '" aria-label="Excluir despesa" title="Excluir despesa">' +
      '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />' +
      '</svg>' +
      '</button>' +
      '</div>' +
      '</div>'
    );
  }

  function renderExpenses() {
    var wrap = document.getElementById('expenses-tbody');
    if (!wrap) return;
    var sorted = state.expenses.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
    var visible = state.view === 'despesas' ? sorted : sorted.slice(0, 8);
    if (visible.length === 0) {
      wrap.innerHTML =
        '<p class="text-sm text-gray-500 py-6 text-center">Nenhuma despesa registrada ainda.</p>';
      return;
    }
    wrap.innerHTML = visible.map(buildExpenseRowHTML).join('');
  }

  function renderAlerts() {
    var section = document.getElementById('alerts-section');
    if (section) {
      section.innerHTML = '';
      if (state.alerts.length === 0) {
        section.innerHTML =
          '<div class="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-5 py-4 text-sm text-emerald-300">' +
          '✅ Nenhum alerta no momento. Tudo sob controle!</div>';
      } else {
        state.alerts.forEach(function (alertItem) {
          var card = document.createElement('div');
          card.className =
            'bg-red-500/10 border border-red-500/30 rounded-2xl px-5 py-4 flex items-center gap-4';
          card.innerHTML =
            '<div class="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">' +
            '<svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
            '<path d="M12 9v2m0 4h.01 M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94 a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />' +
            '</svg></div>' +
            '<div class="flex-1 min-w-0">' +
            '<p class="text-red-300 font-semibold text-sm">' +
            escapeHtml(alertItem.title) +
            '</p>' +
            '<p class="text-red-400 text-xs mt-0.5">' +
            escapeHtml(alertItem.message) +
            '</p>' +
            '</div>' +
            '<button type="button" class="alert-dismiss text-red-400 text-xl leading-none flex-shrink-0 hover:text-red-200" data-id="' +
            escapeHtml(alertItem.id) +
            '" aria-label="Dispensar alerta">&times;</button>';
          section.appendChild(card);
        });
      }
    }

    ['alert-badge-desktop', 'alert-badge-mobile'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (state.alerts.length > 0) {
        el.textContent = String(state.alerts.length);
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });

    // religar botões de dispensar após re-render
    document.querySelectorAll('.alert-dismiss').forEach(function (btn) {
      btn.addEventListener('click', function () {
        dismissAlert(btn.getAttribute('data-id'));
      });
    });
  }

  function renderAll() {
    renderKPIs();
    renderCategories();
    renderChart();
    renderAlerts();
    renderExpenses();
    applyView(state.view, { skipScroll: true });
  }

  /* -----------------------------------------------------------
     4. NAVEGAÇÃO / MENU
     ----------------------------------------------------------- */

  function applyView(view, opts) {
    opts = opts || {};
    if (!VIEW_SECTIONS[view]) view = 'dashboard';
    state.view = view;

    var loggedIn = !!loadSession();
    var showLocked = GATED_VIEWS.indexOf(view) !== -1 && !loggedIn;

    ALL_SECTIONS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (id === 'locked-section') {
        el.style.display = showLocked ? '' : 'none';
        return;
      }
      var show = !showLocked && VIEW_SECTIONS[view].indexOf(id) !== -1;
      el.style.display = show ? '' : 'none';
    });

    if (view === 'plano') {
      renderPlanCards();
      renderPaymentsHistory();
    }

    // links do menu lateral (desktop)
    document.querySelectorAll('.side-nav-link[data-view]').forEach(function (link) {
      var active = link.getAttribute('data-view') === view;
      var icon = link.querySelector('.side-nav-icon');
      if (active) {
        link.classList.add('bg-emerald-500/20', 'border', 'border-emerald-500/30', 'text-white');
        link.classList.remove('text-gray-400');
        if (icon) icon.classList.add('text-emerald-400');
      } else {
        link.classList.remove('bg-emerald-500/20', 'border', 'border-emerald-500/30', 'text-white');
        link.classList.add('text-gray-400');
        if (icon) icon.classList.remove('text-emerald-400');
      }
    });

    // nav inferior (mobile)
    document.querySelectorAll('.bottom-nav-link[data-view]').forEach(function (link) {
      var active = link.getAttribute('data-view') === view;
      if (active) {
        link.classList.add('text-emerald-400');
        link.classList.remove('text-gray-500');
      } else {
        link.classList.remove('text-emerald-400');
        link.classList.add('text-gray-500');
      }
    });

    var titleInfo = VIEW_TITLES[view];
    var titleEl = document.getElementById('page-title');
    var subtitleEl = document.getElementById('page-subtitle');
    if (titleEl && titleInfo) titleEl.textContent = titleInfo[0];
    if (subtitleEl && titleInfo) subtitleEl.textContent = titleInfo[1];
    if (view === 'dashboard') updateGreeting();

    // a lista de despesas muda de tamanho dependendo da view (completa em "Despesas")
    renderExpenses();

    if (!opts.skipScroll) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function setupMenu() {
    document.querySelectorAll('[data-view]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        applyView(link.getAttribute('data-view'));
      });
    });

    var verTodas = document.getElementById('link-ver-todas');
    if (verTodas) {
      verTodas.addEventListener('click', function (e) {
        e.preventDefault();
        applyView('despesas');
      });
    }
  }

  /* -----------------------------------------------------------
     5. ALERTAS — DISPENSAR
     ----------------------------------------------------------- */

  function dismissAlert(id) {
    state.alerts = state.alerts.filter(function (a) {
      return a.id !== id;
    });
    saveState();
    renderAlerts();
  }

  // Confere despesas por categoria + orçamento total contra os limites
  // planejados e mantém os alertas em dia: cria quando estoura, remove
  // quando volta a ficar dentro do orçamento (nova despesa, exclusão de
  // despesa ou edição do valor do orçamento passam por aqui).
  function reevaluateBudgetAlerts() {
    Object.keys(CATEGORY_BUDGETS).forEach(function (cat) {
      var alertId = 'alert-cat-' + cat;
      var budget = CATEGORY_BUDGETS[cat];
      var value = Number(state.categoryTotals[cat]) || 0;
      var over = budget && value > budget;
      var exists = state.alerts.some(function (a) {
        return a.id === alertId;
      });

      if (over && !exists) {
        var cfg = CATEGORY_CONFIG[cat];
        state.alerts.push({
          id: alertId,
          title: '⚠️ Orçamento ultrapassado em ' + cfg.label,
          message:
            'Você gastou R$ ' + formatMoney(value) + ' de R$ ' + formatMoney(budget) + ' planejados este mês.'
        });
      } else if (!over && exists) {
        state.alerts = state.alerts.filter(function (a) {
          return a.id !== alertId;
        });
      }
    });

    var totalAlertId = 'alert-total-estourado';
    var overTotal = state.orcamentoTotal > 0 && state.gastosMes >= state.orcamentoTotal;
    var existsTotal = state.alerts.some(function (a) {
      return a.id === totalAlertId;
    });

    if (overTotal && !existsTotal) {
      state.alerts.push({
        id: totalAlertId,
        title: '⚠️ Orçamento mensal estourado',
        message:
          'Seus gastos (R$ ' +
          formatMoney(state.gastosMes) +
          ') já superam o orçamento total de R$ ' +
          formatMoney(state.orcamentoTotal) +
          '.'
      });
    } else if (!overTotal && existsTotal) {
      state.alerts = state.alerts.filter(function (a) {
        return a.id !== totalAlertId;
      });
    }
  }

  /* -----------------------------------------------------------
     5b. DESPESAS — EXCLUIR (botão ícone X em cada linha)
     ----------------------------------------------------------- */

  function deleteExpense(id) {
    if (!requireLogin()) return;
    var idx = -1;
    for (var i = 0; i < state.expenses.length; i++) {
      if (state.expenses[i].id === id) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return;

    var exp = state.expenses[idx];
    if (!window.confirm('Excluir a despesa "' + exp.desc + '"?')) return;

    state.expenses.splice(idx, 1);
    state.categoryTotals[exp.category] = Math.max(0, (Number(state.categoryTotals[exp.category]) || 0) - exp.value);
    state.gastosMes = Math.max(0, state.gastosMes - exp.value);
    state.saldo += exp.value;
    state.lancamentosCount = Math.max(0, state.lancamentosCount - 1);

    reevaluateBudgetAlerts();
    saveState();
    renderAll();
    showToast('Despesa "' + exp.desc + '" excluída.');
  }

  /* -----------------------------------------------------------
     6. MODAL "NOVA DESPESA" — TEXT INPUT INTEGRADO
     ----------------------------------------------------------- */

  var modal = null;
  var form = null;
  var formError = null;

  function openModal() {
    if (!modal) return;
    if (!requireLogin()) return;
    var dateInput = document.getElementById('expense-date');
    if (dateInput && !dateInput.value) dateInput.value = todayISO();
    hideFormError();
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    var descInput = document.getElementById('expense-desc');
    if (descInput) descInput.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    if (form) form.reset();
    hideFormError();
  }

  function showFormError(message) {
    if (!formError) return;
    formError.textContent = message;
    formError.classList.remove('hidden');
  }

  function hideFormError() {
    if (!formError) return;
    formError.textContent = '';
    formError.classList.add('hidden');
  }

  function showToast(message) {
    var toast = document.getElementById('toast');
    if (!toast) return;
    if (message) toast.textContent = message;
    toast.classList.remove('hidden');
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(function () {
      toast.classList.add('hidden');
    }, 2600);
  }

  function handleExpenseSubmit(e) {
    e.preventDefault();
    hideFormError();

    var user = loadSession();
    if (!user) {
      showFormError('Faça login para registrar despesas.');
      closeModal();
      openAuthModal('login');
      return;
    }

    var desc = document.getElementById('expense-desc').value.trim();
    var category = document.getElementById('expense-category').value;
    var date = document.getElementById('expense-date').value;
    var rawValue = document.getElementById('expense-value').value;
    var value = parseFloat(rawValue.replace(',', '.'));

    if (!desc) {
      showFormError('Informe uma descrição para a despesa.');
      return;
    }
    if (!CATEGORY_CONFIG[category]) {
      showFormError('Selecione uma categoria válida.');
      return;
    }
    if (!date) {
      showFormError('Informe a data da despesa.');
      return;
    }
    if (!value || isNaN(value) || value <= 0) {
      showFormError('Informe um valor válido, maior que zero.');
      return;
    }

    var plan = PLANS[user.plan || 'free'] || PLANS.free;
    var todayStr = todayISO();
    var usedToday = state.expenses.filter(function (item) {
      return item.ownerCpf === user.cpf && (item.createdAt || '').slice(0, 10) === todayStr;
    }).length;
    var isExtra = isFinite(plan.max_expenses_day) && usedToday >= plan.max_expenses_day;

    function finalizeExpense(txid, analysis) {
      var expense = {
        id: 'e-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        desc: desc,
        category: category,
        date: date,
        value: Math.round(value * 100) / 100,
        ownerCpf: user.cpf,
        createdAt: new Date().toISOString(),
        isExtra: isExtra,
        extraCharge: isExtra ? plan.overage_price : 0,
        extraTxid: isExtra ? txid : null
      };

      state.expenses.unshift(expense);
      state.categoryTotals[category] = (Number(state.categoryTotals[category]) || 0) + expense.value;
      state.gastosMes += expense.value;
      state.saldo -= expense.value;
      state.lancamentosCount += 1;
      state.novosNestaSessao += 1;

      reevaluateBudgetAlerts();

      saveState();
      renderAll();

      if (isExtra) {
        recordPayment({
          cpf: user.cpf,
          type: 'despesa_extra',
          amount: plan.overage_price,
          txid: txid,
          verifiedByAI: !!(analysis && analysis.amountMatches && analysis.merchantMatches),
          aiClassification: analysis ? analysis.classification : null
        });
        showToast(
          'Pagamento confirmado! Despesa extra "' + desc + '" registrada (R$ ' + formatMoney(plan.overage_price) + ').'
        );
      } else {
        showToast('Despesa "' + desc + '" adicionada com sucesso!');
      }
    }

    if (isExtra) {
      // Limite diário do plano Free atingido: a despesa só é salva depois
      // que o comprovante do Pix de R$ 5,00 for enviado e a IA (OCR local)
      // validar o pagamento — ver setupPixModal()/handleReceiptUpload().
      closeModal();
      openPixPayment({
        amount: plan.overage_price,
        description: 'Despesa extra — limite diário do plano Free',
        txidPrefix: 'DESP',
        expectedType: 'despesa',
        onConfirm: finalizeExpense
      });
    } else {
      finalizeExpense(null, null);
      closeModal();
    }
  }

  function setupModal() {
    modal = document.getElementById('expense-modal');
    form = document.getElementById('expense-form');
    formError = document.getElementById('expense-form-error');

    var openBtns = [document.getElementById('btn-new-expense'), document.getElementById('btn-new-expense-mobile')];
    openBtns.forEach(function (btn) {
      if (btn) btn.addEventListener('click', openModal);
    });

    var closeBtn = document.getElementById('expense-modal-close');
    var cancelBtn = document.getElementById('expense-modal-cancel');
    var backdrop = document.getElementById('expense-modal-backdrop');

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
        closeModal();
      }
    });

    if (form) form.addEventListener('submit', handleExpenseSubmit);
  }

  /* -----------------------------------------------------------
     6b. MODAL "EDITAR ORÇAMENTO"
     ----------------------------------------------------------- */

  var budgetModal = null;
  var budgetForm = null;
  var budgetFormError = null;

  function openBudgetModal() {
    if (!budgetModal) return;
    if (!requireLogin()) return;
    hideBudgetFormError();
    var valueInput = document.getElementById('budget-value');
    if (valueInput) {
      valueInput.value = state.orcamentoTotal > 0 ? state.orcamentoTotal.toFixed(2) : '';
    }
    budgetModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (valueInput) {
      valueInput.focus();
      valueInput.select();
    }
  }

  function closeBudgetModal() {
    if (!budgetModal) return;
    budgetModal.classList.add('hidden');
    document.body.style.overflow = '';
    hideBudgetFormError();
  }

  function showBudgetFormError(message) {
    if (!budgetFormError) return;
    budgetFormError.textContent = message;
    budgetFormError.classList.remove('hidden');
  }

  function hideBudgetFormError() {
    if (!budgetFormError) return;
    budgetFormError.textContent = '';
    budgetFormError.classList.add('hidden');
  }

  function handleBudgetSubmit(e) {
    e.preventDefault();
    hideBudgetFormError();

    if (!loadSession()) {
      showBudgetFormError('Faça login para editar o orçamento.');
      closeBudgetModal();
      openAuthModal('login');
      return;
    }

    var rawValue = document.getElementById('budget-value').value;
    var value = parseFloat(String(rawValue).replace(',', '.'));

    if (!value || isNaN(value) || value <= 0) {
      showBudgetFormError('Informe um valor de orçamento válido, maior que zero.');
      return;
    }

    state.orcamentoTotal = Math.round(value * 100) / 100;
    reevaluateBudgetAlerts();
    saveState();
    renderAll();
    closeBudgetModal();
    showToast('Orçamento atualizado para R$ ' + formatMoney(state.orcamentoTotal) + '.');
  }

  function setupBudgetModal() {
    budgetModal = document.getElementById('budget-modal');
    budgetForm = document.getElementById('budget-form');
    budgetFormError = document.getElementById('budget-form-error');

    var openBtn = document.getElementById('btn-edit-budget');
    if (openBtn) openBtn.addEventListener('click', openBudgetModal);

    var closeBtn = document.getElementById('budget-modal-close');
    var cancelBtn = document.getElementById('budget-modal-cancel');
    var backdrop = document.getElementById('budget-modal-backdrop');

    if (closeBtn) closeBtn.addEventListener('click', closeBudgetModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeBudgetModal);
    if (backdrop) backdrop.addEventListener('click', closeBudgetModal);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && budgetModal && !budgetModal.classList.contains('hidden')) {
        closeBudgetModal();
      }
    });

    if (budgetForm) budgetForm.addEventListener('submit', handleBudgetSubmit);
  }

  /* -----------------------------------------------------------
     7. ALERTA — FECHAR VIA CLIQUE (delegação, cobre re-renders)
     ----------------------------------------------------------- */

  function setupAlertDelegation() {
    document.addEventListener('click', function (e) {
      var dismissBtn = e.target.closest ? e.target.closest('.alert-dismiss') : null;
      if (dismissBtn) {
        dismissAlert(dismissBtn.getAttribute('data-id'));
        return;
      }

      var deleteBtn = e.target.closest ? e.target.closest('.expense-delete') : null;
      if (deleteBtn) {
        deleteExpense(deleteBtn.getAttribute('data-id'));
      }
    });
  }

  /* -----------------------------------------------------------
     8. AUTENTICAÇÃO — ENTRAR / CADASTRAR (Nome + CPF)

     A Receita Federal não permite validar identidade só com
     nome: a consulta oficial de CPF (via ReceitaWS ou o próprio
     site da Receita) exige CPF + data de nascimento e, no caso
     da ReceitaWS, um token pago — e como este site é 100%
     client-side (sem backend), qualquer token ficaria exposto
     no código-fonte para qualquer visitante.

     Por isso a validação abaixo usa o mesmo algoritmo oficial
     de dígitos verificadores que a Receita Federal usa para
     conferir se um número de CPF é válido (módulo 11), rodando
     localmente, sem custo e sem expor nenhuma credencial. O
     nome é conferido de forma cruzada com o CPF no cadastro
     local (localStorage), como uma segunda camada de validação.
     ----------------------------------------------------------- */

  var AUTH_USERS_KEY = 'fintech_auth_users_v1';
  var AUTH_SESSION_KEY = 'fintech_auth_session_v1';

  var authModal = null;
  var authForm = null;
  var authFormError = null;
  var authFormSuccess = null;
  var authMode = 'login';

  function normalizeCPF(value) {
    return (value || '').replace(/\D/g, '');
  }

  function maskCPF(value) {
    var digits = normalizeCPF(value).slice(0, 11);
    digits = digits.replace(/(\d{3})(\d)/, '$1.$2');
    digits = digits.replace(/(\d{3})(\d)/, '$1.$2');
    digits = digits.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    return digits;
  }

  function maskCPFDisplay(cpfDigits) {
    if (!cpfDigits || cpfDigits.length !== 11) return '';
    return '•••.•••.' + cpfDigits.slice(6, 9) + '-' + cpfDigits.slice(9, 11);
  }

  // Algoritmo oficial de validação de dígitos verificadores do CPF (módulo 11)
  function isValidCPF(cpfDigits) {
    var cpf = normalizeCPF(cpfDigits);
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false; // sequências repetidas (000..., 111... etc.) são inválidas

    var sum = 0;
    var i;
    for (i = 0; i < 9; i++) sum += parseInt(cpf.charAt(i), 10) * (10 - i);
    var rev = (sum * 10) % 11;
    if (rev === 10 || rev === 11) rev = 0;
    if (rev !== parseInt(cpf.charAt(9), 10)) return false;

    sum = 0;
    for (i = 0; i < 10; i++) sum += parseInt(cpf.charAt(i), 10) * (11 - i);
    rev = (sum * 10) % 11;
    if (rev === 10 || rev === 11) rev = 0;
    if (rev !== parseInt(cpf.charAt(10), 10)) return false;

    return true;
  }

  function isValidNome(nome) {
    var trimmed = (nome || '').trim().replace(/\s+/g, ' ');
    if (trimmed.length < 3 || trimmed.length > 80) return false;
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ'-]+(\s[A-Za-zÀ-ÖØ-öø-ÿ'-]+)+$/.test(trimmed)) return false; // exige nome + sobrenome
    return true;
  }

  function normalizeNome(nome) {
    return (nome || '')
      .trim()
      .replace(/\s+/g, ' ')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  }

  function loadUsers() {
    try {
      var raw = window.localStorage.getItem(AUTH_USERS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function saveUsers(users) {
    try {
      window.localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
    } catch (err) {
      /* localStorage indisponível — segue sem persistir */
    }
  }

  function findUserByCPF(cpfDigits) {
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].cpf === cpfDigits) return users[i];
    }
    return null;
  }

  function loadSession() {
    try {
      var cpf = window.localStorage.getItem(AUTH_SESSION_KEY);
      if (!cpf) return null;
      return findUserByCPF(cpf);
    } catch (err) {
      return null;
    }
  }

  function saveSession(cpfDigits) {
    try {
      window.localStorage.setItem(AUTH_SESSION_KEY, cpfDigits);
    } catch (err) {
      /* localStorage indisponível — segue sem persistir */
    }
  }

  function clearSession() {
    try {
      window.localStorage.removeItem(AUTH_SESSION_KEY);
    } catch (err) {
      /* localStorage indisponível */
    }
  }

  // Exige login para usar uma funcionalidade do sistema. Se não houver
  // sessão ativa, avisa e abre o modal de login/cadastro.
  function requireLogin() {
    var user = loadSession();
    if (!user) {
      showToast('Faça login para usar essa funcionalidade.');
      openAuthModal('login');
      return null;
    }
    return user;
  }

  function renderPlanInfo() {
    var el = document.getElementById('plan-quota-info');
    if (!el) return;
    var user = loadSession();
    if (!user) {
      el.classList.add('hidden');
      return;
    }
    var plan = PLANS[user.plan || 'free'] || PLANS.free;
    el.classList.remove('hidden');
    if (!isFinite(plan.max_expenses_day)) {
      el.textContent = 'Plano Premium · despesas ilimitadas';
      return;
    }
    var todayStr = todayISO();
    var usedToday = state.expenses.filter(function (item) {
      return item.ownerCpf === user.cpf && (item.createdAt || '').slice(0, 10) === todayStr;
    }).length;
    var remaining = Math.max(0, plan.max_expenses_day - usedToday);
    el.textContent =
      'Plano Free · ' + usedToday + '/' + plan.max_expenses_day + ' despesas hoje' +
      (remaining > 0
        ? ' (restam ' + remaining + ')'
        : ' — extras a R$ ' + formatMoney(plan.overage_price) + '/unidade');
  }

  function renderPlanCards() {
    var container = document.getElementById('plan-cards');
    if (!container) return;
    var user = loadSession();
    var currentPlan = user ? user.plan || 'free' : null;

    container.innerHTML = Object.keys(PLANS)
      .map(function (key) {
        var p = PLANS[key];
        var isCurrent = key === currentPlan;
        var expensesLabel = isFinite(p.max_expenses_day)
          ? p.max_expenses_day + ' despesas/dia (extra: R$ ' + formatMoney(p.overage_price) + '/unidade)'
          : 'Despesas ilimitadas';

        return (
          '<div class="bg-gray-900 border ' +
          (isCurrent ? 'border-emerald-500' : 'border-gray-800') +
          ' rounded-2xl p-6 text-center">' +
          '<h3 class="text-base font-semibold text-white mb-1">' + escapeHtml(p.label) + '</h3>' +
          '<p class="text-2xl font-bold text-white mb-3">R$ ' + formatMoney(p.price_month) +
          '<span class="text-sm font-normal text-gray-500">/mês</span></p>' +
          '<p class="text-sm text-gray-400 mb-1">Acesso completo ao sistema</p>' +
          '<p class="text-sm text-gray-400 mb-4">' + expensesLabel + '</p>' +
          (isCurrent
            ? '<p class="text-xs text-emerald-400 font-semibold">Plano atual</p>'
            : '<button type="button" class="select-plan-btn inline-flex items-center gap-2 ' +
              'bg-emerald-500 hover:bg-emerald-400 text-gray-900 font-semibold text-sm ' +
              'px-4 py-2.5 rounded-xl transition" data-plan="' + key + '">Selecionar</button>') +
          '</div>'
        );
      })
      .join('');

    container.querySelectorAll('.select-plan-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectPlan(btn.getAttribute('data-plan'));
      });
    });
  }

  function applyPlanChange(cpf, planKey) {
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].cpf === cpf) {
        users[i].plan = planKey;
        break;
      }
    }
    saveUsers(users);
    renderPlanCards();
    renderPlanInfo();
  }

  function selectPlan(planKey) {
    var user = requireLogin();
    if (!user || !PLANS[planKey]) return;

    // Downgrade para Free não envolve cobrança.
    if (planKey === 'free') {
      applyPlanChange(user.cpf, planKey);
      showToast('Plano alterado para Free.');
      return;
    }

    var plan = PLANS[planKey];
    openPixPayment({
      amount: plan.price_month,
      description: 'Assinatura ' + plan.label + ' — Fintech Inteligente',
      txidPrefix: 'PLANO',
      expectedType: planKey === 'premium' ? 'plano_premium' : 'plano_free',
      onConfirm: function (txid, analysis) {
        applyPlanChange(user.cpf, planKey);
        recordPayment({
          cpf: user.cpf,
          type: 'plano',
          plan: planKey,
          amount: plan.price_month,
          txid: txid,
          verifiedByAI: !!(analysis && analysis.amountMatches && analysis.merchantMatches),
          aiClassification: analysis ? analysis.classification : null
        });
        showToast('Pagamento confirmado! Plano atualizado para ' + plan.label + '.');
      }
    });
  }

  /* -----------------------------------------------------------
     6c. PAGAMENTO VIA PIX (QR real + copia-e-cola, confirmação manual)
     ----------------------------------------------------------- */

  function loadPayments() {
    try {
      var raw = window.localStorage.getItem(PAYMENTS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function savePayments(list) {
    try {
      window.localStorage.setItem(PAYMENTS_KEY, JSON.stringify(list));
    } catch (err) {
      /* localStorage indisponível — segue sem persistir */
    }
  }

  function recordPayment(opts) {
    var payments = loadPayments();
    payments.unshift({
      id: 'pay-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      cpf: opts.cpf,
      type: opts.type, // 'plano' | 'despesa_extra'
      plan: opts.plan || null,
      amount: opts.amount,
      txid: opts.txid,
      verifiedByAI: !!opts.verifiedByAI, // comprovante lido e validado pela IA (OCR local)
      aiClassification: opts.aiClassification || null,
      date: new Date().toISOString()
    });
    savePayments(payments);
  }

  function renderPaymentsHistory() {
    var container = document.getElementById('payments-history');
    if (!container) return;
    var user = loadSession();
    if (!user) {
      container.innerHTML = '';
      return;
    }
    var payments = loadPayments().filter(function (p) {
      return p.cpf === user.cpf;
    });
    if (payments.length === 0) {
      container.innerHTML = '<p class="text-sm text-gray-500">Nenhum pagamento registrado ainda.</p>';
      return;
    }
    container.innerHTML = payments
      .map(function (p) {
        var label =
          p.type === 'plano'
            ? 'Assinatura ' + (PLANS[p.plan] ? PLANS[p.plan].label : p.plan)
            : 'Despesa extra (limite diário)';
        var dt = new Date(p.date);
        var dtLabel = formatDateBR(dt.toISOString().slice(0, 10)) + ' ' + dt.toTimeString().slice(0, 5);
        var badge = p.verifiedByAI
          ? '<span class="text-emerald-400">✓ comprovante validado por IA' +
            (ReceiptAI && ReceiptAI.TYPE_LABELS[p.aiClassification]
              ? ' · ' + escapeHtml(ReceiptAI.TYPE_LABELS[p.aiClassification])
              : '') +
            '</span>'
          : '<span class="text-amber-400">⚠ confirmação manual (não validado por IA)</span>';
        return (
          '<div class="flex items-center justify-between py-2.5 border-b border-gray-800 last:border-0">' +
          '<div><p class="text-sm text-white">' + escapeHtml(label) + '</p>' +
          '<p class="text-xs text-gray-500">' + dtLabel + ' · txid ' + escapeHtml(p.txid || '-') + '</p>' +
          '<p class="text-xs mt-0.5">' + badge + '</p></div>' +
          '<span class="text-sm font-semibold text-emerald-400">R$ ' + formatMoney(p.amount) + '</span>' +
          '</div>'
        );
      })
      .join('');
  }

  var pixModal = null;
  var pixConfirmCallback = null;
  var pixCurrentTxid = null;
  var pixCurrentAmount = 0;
  var pixExpectedType = null;
  var pixReceiptAnalysis = null;
  var pixReceiptInput = null;
  var pixReceiptStatus = null;
  var pixConfirmBtn = null;

  function setupPixModal() {
    pixModal = document.getElementById('pix-modal');
    if (!pixModal) return;

    var closeBtn = document.getElementById('pix-modal-close');
    var cancelBtn = document.getElementById('pix-modal-cancel');
    var backdrop = document.getElementById('pix-modal-backdrop');
    var copyBtn = document.getElementById('pix-modal-copy');

    pixReceiptInput = document.getElementById('pix-receipt-input');
    pixReceiptStatus = document.getElementById('pix-receipt-status');
    pixConfirmBtn = document.getElementById('pix-modal-confirm');

    if (closeBtn) closeBtn.addEventListener('click', closePixModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closePixModal);
    if (backdrop) backdrop.addEventListener('click', closePixModal);

    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var code = document.getElementById('pix-modal-code').textContent.trim();
        copyTextToClipboard(code, copyBtn);
      });
    }

    if (pixReceiptInput) {
      pixReceiptInput.addEventListener('change', function () {
        handleReceiptUpload(pixReceiptInput.files && pixReceiptInput.files[0]);
      });
    }

    if (pixConfirmBtn) {
      pixConfirmBtn.addEventListener('click', function () {
        if (pixConfirmBtn.disabled) return;
        var cb = pixConfirmCallback;
        var txid = pixCurrentTxid;
        var analysis = pixReceiptAnalysis;
        closePixModal();
        if (cb) cb(txid, analysis);
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && pixModal && !pixModal.classList.contains('hidden')) closePixModal();
    });
  }

  function setPixConfirmState(enabled, label, tone) {
    if (!pixConfirmBtn) return;
    pixConfirmBtn.disabled = !enabled;
    pixConfirmBtn.textContent = label;
    pixConfirmBtn.classList.remove(
      'bg-emerald-500', 'hover:bg-emerald-400',
      'bg-amber-500', 'hover:bg-amber-400',
      'bg-emerald-500/40', 'cursor-not-allowed'
    );
    if (!enabled) {
      pixConfirmBtn.classList.add('bg-emerald-500/40', 'cursor-not-allowed');
    } else if (tone === 'warn') {
      pixConfirmBtn.classList.add('bg-amber-500', 'hover:bg-amber-400');
    } else {
      pixConfirmBtn.classList.add('bg-emerald-500', 'hover:bg-emerald-400');
    }
  }

  // Lê o comprovante enviado com a IA (OCR local, via ReceiptAI) e confere
  // se o valor/recebedor batem com o pagamento pendente. Habilita o botão
  // de confirmação com um rótulo diferente conforme o resultado — o envio
  // manual continua possível quando a IA não consegue validar sozinha.
  function handleReceiptUpload(file) {
    pixReceiptAnalysis = null;
    setPixConfirmState(false, 'Envie o comprovante');
    if (!pixReceiptStatus) return;

    if (!file) {
      pixReceiptStatus.textContent = '';
      return;
    }

    pixReceiptStatus.textContent = 'Lendo comprovante com IA (OCR local no navegador)...';
    pixReceiptStatus.className = 'text-xs text-gray-400 mt-2 text-left';

    if (!window.ReceiptAI) {
      pixReceiptStatus.textContent = 'IA de leitura indisponível neste navegador. Você pode confirmar manualmente.';
      pixReceiptStatus.className = 'text-xs text-amber-400 mt-2 text-left';
      setPixConfirmState(true, 'Confirmar manualmente', 'warn');
      return;
    }

    ReceiptAI.analyze(file, { expectedAmount: pixCurrentAmount, expectedType: pixExpectedType })
      .then(function (result) {
        pixReceiptAnalysis = result;
        renderReceiptResult(result);
      })
      .catch(function () {
        pixReceiptStatus.textContent =
          'Não foi possível ler o comprovante automaticamente. Confira os dados e confirme manualmente.';
        pixReceiptStatus.className = 'text-xs text-amber-400 mt-2 text-left';
        setPixConfirmState(true, 'Confirmar manualmente', 'warn');
      });
  }

  function renderReceiptResult(result) {
    if (!pixReceiptStatus) return;
    var typeLabel = (window.ReceiptAI && ReceiptAI.TYPE_LABELS[result.classification]) || 'Outros';

    if (result.amountMatches && result.merchantMatches) {
      pixReceiptStatus.textContent =
        '✅ Comprovante validado pela IA — R$ ' + formatMoney(result.detectedAmount) + ' · ' + typeLabel + '.';
      pixReceiptStatus.className = 'text-xs text-emerald-400 mt-2 text-left';
      setPixConfirmState(true, 'Confirmar pagamento');
    } else {
      var reasons = [];
      if (!result.merchantMatches) reasons.push('não encontramos o recebedor (SPACECWORP) no comprovante');
      if (!result.amountMatches) reasons.push('o valor não bate com R$ ' + formatMoney(pixCurrentAmount));
      pixReceiptStatus.textContent =
        '⚠️ Não deu para validar automaticamente (' + reasons.join(' e ') + '). Confira o comprovante ou envie ' +
        'mesmo assim para revisão manual.';
      pixReceiptStatus.className = 'text-xs text-amber-400 mt-2 text-left';
      setPixConfirmState(true, 'Enviar mesmo assim', 'warn');
    }
  }

  // opts: { amount, description, txidPrefix, expectedType, onConfirm(txid, analysis) }
  function openPixPayment(opts) {
    if (!pixModal) return;
    opts = opts || {};

    var txid = Pix.generateTxid(opts.txidPrefix || 'FIN');
    var payload;
    try {
      payload = Pix.buildPayload({
        key: PIX_MERCHANT.key,
        name: PIX_MERCHANT.name,
        city: PIX_MERCHANT.city,
        amount: opts.amount,
        description: opts.description,
        txid: txid
      });
    } catch (err) {
      showToast('Não foi possível gerar o código Pix.');
      return;
    }

    document.getElementById('pix-modal-desc').textContent = opts.description || '';
    document.getElementById('pix-modal-amount').textContent = 'R$ ' + formatMoney(opts.amount || 0);
    document.getElementById('pix-modal-code').textContent = payload;

    var qrEl = document.getElementById('pix-qrcode');
    if (qrEl) {
      qrEl.innerHTML = '';
      if (window.QRCode) {
        new QRCode(qrEl, { text: payload, width: 176, height: 176, correctLevel: QRCode.CorrectLevel.M });
      } else {
        qrEl.textContent = 'QR indisponível — use o código copia e cola abaixo.';
      }
    }

    pixCurrentTxid = txid;
    pixCurrentAmount = opts.amount || 0;
    pixExpectedType = opts.expectedType || null;
    pixReceiptAnalysis = null;
    pixConfirmCallback = typeof opts.onConfirm === 'function' ? opts.onConfirm : null;

    if (pixReceiptInput) pixReceiptInput.value = '';
    if (pixReceiptStatus) {
      pixReceiptStatus.textContent = '';
      pixReceiptStatus.className = 'text-xs text-gray-500 mt-2 min-h-[1rem] text-left';
    }
    setPixConfirmState(false, 'Envie o comprovante');

    pixModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closePixModal() {
    if (!pixModal) return;
    pixModal.classList.add('hidden');
    document.body.style.overflow = '';
    pixConfirmCallback = null;
    pixCurrentTxid = null;
    pixReceiptAnalysis = null;
  }

  function updateGreeting() {
    var subtitleEl = document.getElementById('page-subtitle');
    if (!subtitleEl || state.view !== 'dashboard') return;
    var user = loadSession();
    var firstName = user && user.name ? user.name.trim().split(' ')[0] : 'Usuário';
    subtitleEl.textContent = 'Bem-vindo(a), ' + firstName + '!';
  }

  function renderAccount() {
    var sidebar = document.getElementById('sidebar-account');
    var mobileAvatar = document.getElementById('mobile-account-avatar');
    var topbarBtn = document.getElementById('btn-open-auth-topbar');
    var user = loadSession();

    if (topbarBtn) topbarBtn.classList.toggle('hidden', !!user);
    updateGreeting();
    renderPlanInfo();
    // login/logout pode destravar ou travar a view atual (ex.: Dashboard)
    applyView(state.view, { skipScroll: true });

    if (user) {
      var initial = escapeHtml(user.name.trim().charAt(0).toUpperCase() || '?');
      if (sidebar) {
        sidebar.innerHTML =
          '<div class="flex items-center gap-3">' +
          '<div class="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center font-bold text-sm text-gray-900">' +
          initial +
          '</div>' +
          '<div class="min-w-0">' +
          '<p class="text-sm font-medium text-white truncate">' +
          escapeHtml(user.name) +
          '</p>' +
          '<p class="text-xs text-gray-500">CPF: ' +
          maskCPFDisplay(user.cpf) +
          '</p>' +
          '</div>' +
          '<button type="button" id="btn-logout-sidebar" title="Sair" ' +
          'class="ml-auto text-gray-500 hover:text-red-400 text-xs font-medium">Sair</button>' +
          '</div>';
        var logoutBtn = document.getElementById('btn-logout-sidebar');
        if (logoutBtn) logoutBtn.addEventListener('click', logout);
      }
      if (mobileAvatar) {
        mobileAvatar.textContent = initial;
        mobileAvatar.setAttribute('title', escapeHtml(user.name) + ' · toque para sair');
      }
    } else {
      if (sidebar) {
        sidebar.innerHTML =
          '<button type="button" id="btn-open-auth-sidebar" ' +
          'class="w-full flex items-center justify-center gap-2 text-sm font-medium ' +
          'text-gray-900 bg-emerald-500 hover:bg-emerald-400 rounded-xl py-2.5 transition">' +
          '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />' +
          '</svg>Entrar / Cadastrar</button>';
        var openBtn = document.getElementById('btn-open-auth-sidebar');
        if (openBtn) openBtn.addEventListener('click', function () { openAuthModal('login'); });
      }
      if (mobileAvatar) {
        mobileAvatar.textContent = '?';
        mobileAvatar.setAttribute('title', 'Entrar / Cadastrar');
      }
    }
  }

  function setAuthMode(mode) {
    authMode = mode === 'register' ? 'register' : 'login';
    var loginTab = document.getElementById('auth-tab-login');
    var registerTab = document.getElementById('auth-tab-register');
    var submitBtn = document.getElementById('auth-submit-btn');

    [loginTab, registerTab].forEach(function (tab) {
      if (!tab) return;
      tab.classList.remove('bg-emerald-500', 'text-gray-900');
      tab.classList.add('text-gray-400');
    });

    var activeTab = authMode === 'login' ? loginTab : registerTab;
    if (activeTab) {
      activeTab.classList.add('bg-emerald-500', 'text-gray-900');
      activeTab.classList.remove('text-gray-400');
    }
    if (submitBtn) submitBtn.textContent = authMode === 'login' ? 'Entrar' : 'Criar conta';

    hideAuthMessages();
  }

  function openAuthModal(mode) {
    if (!authModal) return;
    setAuthMode(mode || 'login');
    hideAuthMessages();
    authModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    var nomeInput = document.getElementById('auth-nome');
    if (nomeInput) nomeInput.focus();
  }

  function closeAuthModal() {
    if (!authModal) return;
    authModal.classList.add('hidden');
    document.body.style.overflow = '';
    if (authForm) authForm.reset();
    hideAuthMessages();
  }

  function showAuthError(message) {
    if (!authFormError) return;
    if (authFormSuccess) authFormSuccess.classList.add('hidden');
    authFormError.textContent = message;
    authFormError.classList.remove('hidden');
  }

  function showAuthSuccess(message) {
    if (!authFormSuccess) return;
    if (authFormError) authFormError.classList.add('hidden');
    authFormSuccess.textContent = message;
    authFormSuccess.classList.remove('hidden');
  }

  function hideAuthMessages() {
    if (authFormError) {
      authFormError.textContent = '';
      authFormError.classList.add('hidden');
    }
    if (authFormSuccess) {
      authFormSuccess.textContent = '';
      authFormSuccess.classList.add('hidden');
    }
  }

  function handleAuthSubmit(e) {
    e.preventDefault();
    hideAuthMessages();

    var nomeInput = document.getElementById('auth-nome');
    var cpfInput = document.getElementById('auth-cpf');
    var nome = nomeInput.value.trim().replace(/\s+/g, ' ');
    var cpfDigits = normalizeCPF(cpfInput.value);

    if (!isValidNome(nome)) {
      showAuthError('Informe seu nome completo (nome e sobrenome).');
      return;
    }
    if (!isValidCPF(cpfDigits)) {
      showAuthError('CPF inválido. Verifique os números digitados.');
      return;
    }

    if (authMode === 'register') {
      var existing = findUserByCPF(cpfDigits);
      if (existing) {
        showAuthError('Este CPF já está cadastrado. Use a aba "Entrar".');
        setAuthMode('login');
        return;
      }
      var users = loadUsers();
      users.push({ name: nome, cpf: cpfDigits, plan: 'free', createdAt: new Date().toISOString() });
      saveUsers(users);
      saveSession(cpfDigits);
      renderAccount();
      showToast('Conta criada! Bem-vindo(a), ' + nome.split(' ')[0] + '.');
      closeAuthModal();
    } else {
      var user = findUserByCPF(cpfDigits);
      if (!user) {
        showAuthError('CPF não encontrado. Crie uma conta na aba "Criar conta".');
        return;
      }
      if (normalizeNome(user.name) !== normalizeNome(nome)) {
        showAuthError('O nome informado não confere com o CPF cadastrado.');
        return;
      }
      saveSession(cpfDigits);
      renderAccount();
      showToast('Bem-vindo(a) de volta, ' + user.name.split(' ')[0] + '!');
      closeAuthModal();
    }
  }

  function logout() {
    clearSession();
    renderAccount();
    showToast('Você saiu da sua conta.');
  }

  function setupAuth() {
    authModal = document.getElementById('auth-modal');
    authForm = document.getElementById('auth-form');
    authFormError = document.getElementById('auth-form-error');
    authFormSuccess = document.getElementById('auth-form-success');

    var cpfInput = document.getElementById('auth-cpf');
    if (cpfInput) {
      cpfInput.addEventListener('input', function () {
        cpfInput.value = maskCPF(cpfInput.value);
      });
    }

    var loginTab = document.getElementById('auth-tab-login');
    var registerTab = document.getElementById('auth-tab-register');
    if (loginTab) loginTab.addEventListener('click', function () { setAuthMode('login'); });
    if (registerTab) registerTab.addEventListener('click', function () { setAuthMode('register'); });

    var topbarBtn = document.getElementById('btn-open-auth-topbar');
    if (topbarBtn) topbarBtn.addEventListener('click', function () { openAuthModal('login'); });

    var lockedBtn = document.getElementById('btn-open-auth-locked');
    if (lockedBtn) lockedBtn.addEventListener('click', function () { openAuthModal('login'); });

    var mobileAvatar = document.getElementById('mobile-account-avatar');
    if (mobileAvatar) {
      mobileAvatar.addEventListener('click', function () {
        var user = loadSession();
        if (user) {
          if (window.confirm('Sair da conta de ' + user.name + '?')) logout();
        } else {
          openAuthModal('login');
        }
      });
    }

    var closeBtn = document.getElementById('auth-modal-close');
    var cancelBtn = document.getElementById('auth-modal-cancel');
    var backdrop = document.getElementById('auth-modal-backdrop');
    if (closeBtn) closeBtn.addEventListener('click', closeAuthModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeAuthModal);
    if (backdrop) backdrop.addEventListener('click', closeAuthModal);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && authModal && !authModal.classList.contains('hidden')) {
        closeAuthModal();
      }
    });

    if (authForm) authForm.addEventListener('submit', handleAuthSubmit);

    setAuthMode('login');
    renderAccount();
  }

  /* -----------------------------------------------------------
     8b. PRODUTOS E SERVIÇOS — COPIAR CHAVE/CÓDIGO PIX
     ----------------------------------------------------------- */

  function copyTextToClipboard(text, btn) {
    var restoreLabel = btn ? btn.textContent : '';

    function onCopied() {
      if (!btn) return;
      btn.textContent = 'Copiado!';
      window.setTimeout(function () {
        btn.textContent = restoreLabel;
      }, 1800);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onCopied, function () {
        fallbackCopy(text);
        onCopied();
      });
    } else {
      fallbackCopy(text);
      onCopied();
    }
  }

  function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      /* navegador sem suporte a copy — ignora silenciosamente */
    }
    document.body.removeChild(textarea);
  }

  function setupPixCopyButtons() {
    var copyKeyBtn = document.getElementById('btn-copy-pix-key');
    var copyCodeBtn = document.getElementById('btn-copy-pix-code');
    var keyEl = document.getElementById('pix-key');
    var codeEl = document.getElementById('pix-copy-paste');

    if (copyKeyBtn && keyEl) {
      copyKeyBtn.addEventListener('click', function () {
        copyTextToClipboard(keyEl.textContent.trim(), copyKeyBtn);
      });
    }
    if (copyCodeBtn && codeEl) {
      copyCodeBtn.addEventListener('click', function () {
        copyTextToClipboard(codeEl.textContent.trim(), copyCodeBtn);
      });
    }
  }

  /* -----------------------------------------------------------
     9. INICIALIZAÇÃO
     ----------------------------------------------------------- */

  function init() {
    setupMenu();
    setupModal();
    setupBudgetModal();
    setupPixModal();
    setupAlertDelegation();
    setupAuth();
    setupPixCopyButtons();
    renderAll();
    applyView('dashboard', { skipScroll: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
