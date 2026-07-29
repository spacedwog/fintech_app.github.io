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

  var STORAGE_KEY = 'fintech_dashboard_state_v1';

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
    alertas: ['alerts-section']
  };

  var ALL_SECTIONS = ['alerts-section', 'kpis-section', 'reports-section', 'expenses-section'];

  var VIEW_TITLES = {
    dashboard: ['Dashboard', 'Junho 2026 · Bem-vindo, Felipe!'],
    despesas: ['Despesas', 'Todas as suas despesas registradas'],
    relatorios: ['Relatórios', 'Gastos mensais e distribuição por categoria'],
    alertas: ['Alertas', 'Avisos sobre o seu orçamento']
  };

  function defaultState() {
    return {
      view: 'dashboard',
      saldo: 4320.0,
      orcamentoTotal: 3500.0,
      gastosMes: 3158.4,
      lancamentosCount: 23,
      novosNestaSessao: 0,
      expenses: [
        { id: 'seed-1', desc: 'Supermercado Extra', category: 'alimentacao', date: '2026-06-17', value: 245.8 },
        { id: 'seed-2', desc: 'Aluguel Junho', category: 'moradia', date: '2026-06-05', value: 900.0 },
        { id: 'seed-3', desc: 'Uber – trabalho', category: 'transporte', date: '2026-06-16', value: 38.5 },
        { id: 'seed-4', desc: 'Netflix + Spotify', category: 'lazer', date: '2026-06-10', value: 75.9 },
        {
          id: 'seed-5',
          desc: 'Farmácia',
          category: 'outros',
          date: '2026-06-14',
          value: 52.3,
          icon: '💊',
          labelOverride: 'Saúde',
          colorOverride: 'emerald'
        }
      ],
      categoryTotals: {
        alimentacao: 1280,
        moradia: 900,
        transporte: 480,
        lazer: 310,
        outros: 188
      },
      alerts: [
        {
          id: 'alert-alimentacao-seed',
          title: '⚠️ Orçamento ultrapassado em Alimentação',
          message: 'Você gastou R$ 1.280,00 de R$ 1.000,00 planejados este mês.'
        },
        {
          id: 'alert-total-seed',
          title: '⚠️ Orçamento quase no limite',
          message: 'Você já usou 90% do orçamento total do mês.'
        }
      ]
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

    var saldoChangeEl = document.getElementById('kpi-saldo-change');
    if (saldoChangeEl) {
      saldoChangeEl.textContent = state.saldo >= 0 ? '▲ saldo positivo' : '▼ saldo negativo';
      saldoChangeEl.className = (state.saldo >= 0 ? 'text-emerald-400' : 'text-red-400') + ' text-xs mt-2';
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
      '<div class="md:col-span-3 text-right ml-auto md:ml-0">' +
      '<span class="text-sm font-semibold text-red-400">- R$ ' +
      formatMoney(exp.value) +
      '</span>' +
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

    ALL_SECTIONS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var show = VIEW_SECTIONS[view].indexOf(id) !== -1;
      el.style.display = show ? '' : 'none';
    });

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

  function maybeCreateAlerts(category, categoryValue) {
    var budget = CATEGORY_BUDGETS[category];
    if (budget && categoryValue > budget) {
      var alertId = 'alert-cat-' + category;
      var already = state.alerts.some(function (a) {
        return a.id === alertId;
      });
      if (!already) {
        var cfg = CATEGORY_CONFIG[category];
        state.alerts.push({
          id: alertId,
          title: '⚠️ Orçamento ultrapassado em ' + cfg.label,
          message:
            'Você gastou R$ ' + formatMoney(categoryValue) + ' de R$ ' + formatMoney(budget) + ' planejados este mês.'
        });
      }
    }

    if (state.orcamentoTotal > 0 && state.gastosMes >= state.orcamentoTotal) {
      var totalAlertId = 'alert-total-estourado';
      var alreadyTotal = state.alerts.some(function (a) {
        return a.id === totalAlertId;
      });
      if (!alreadyTotal) {
        state.alerts.push({
          id: totalAlertId,
          title: '⚠️ Orçamento mensal estourado',
          message: 'Seus gastos (R$ ' + formatMoney(state.gastosMes) + ') já superam o orçamento total do mês.'
        });
      }
    }
  }

  /* -----------------------------------------------------------
     6. MODAL "NOVA DESPESA" — TEXT INPUT INTEGRADO
     ----------------------------------------------------------- */

  var modal = null;
  var form = null;
  var formError = null;

  function openModal() {
    if (!modal) return;
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

    var expense = {
      id: 'e-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      desc: desc,
      category: category,
      date: date,
      value: Math.round(value * 100) / 100
    };

    state.expenses.unshift(expense);
    state.categoryTotals[category] = (Number(state.categoryTotals[category]) || 0) + expense.value;
    state.gastosMes += expense.value;
    state.saldo -= expense.value;
    state.lancamentosCount += 1;
    state.novosNestaSessao += 1;

    maybeCreateAlerts(category, state.categoryTotals[category]);

    saveState();
    renderAll();
    closeModal();
    showToast('Despesa "' + desc + '" adicionada com sucesso!');
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
     7. ALERTA — FECHAR VIA CLIQUE (delegação, cobre re-renders)
     ----------------------------------------------------------- */

  function setupAlertDelegation() {
    document.addEventListener('click', function (e) {
      var target = e.target.closest ? e.target.closest('.alert-dismiss') : null;
      if (target) {
        dismissAlert(target.getAttribute('data-id'));
      }
    });
  }

  /* -----------------------------------------------------------
     8. INICIALIZAÇÃO
     ----------------------------------------------------------- */

  function init() {
    setupMenu();
    setupModal();
    setupAlertDelegation();
    renderAll();
    applyView('dashboard', { skipScroll: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
