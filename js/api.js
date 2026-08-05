// ===============================
// frontend/js/api.js
// Camada de "API" 100% client-side (sem servidor, sem Python).
// Mantém a mesma interface que o antigo client REST usava, mas toda
// a lógica de negócio (antes em FastAPI) roda aqui, no navegador,
// persistindo em localStorage via db.js.
//
// AVISO: como não há servidor, o isolamento entre "contas" (tenants)
// é apenas lógico/organizacional dentro do mesmo navegador — não é uma
// fronteira de segurança real. Qualquer pessoa com acesso ao navegador
// pode inspecionar o localStorage.
// ===============================

const SESSION_KEY = "fintech_saas_session_v1";

// E-mails que sempre têm a conta (tenant) no plano Premium, sem precisar
// pagar via Pix. Aplicado no cadastro e "auto-curado" a cada login, caso o
// plano tenha sido alterado por algum outro motivo.
const PREMIUM_OVERRIDE_EMAILS = ["felipersantos1988@gmail.com"];

function _isPremiumOverrideEmail(email) {
  return PREMIUM_OVERRIDE_EMAILS.includes(String(email || "").trim().toLowerCase());
}

const Auth = {
  getToken() {
    return localStorage.getItem(SESSION_KEY);
  },
  setToken(token) {
    localStorage.setItem(SESSION_KEY, token);
  },
  clearToken() {
    localStorage.removeItem(SESSION_KEY);
  },
  isLoggedIn() {
    return !!this.getToken();
  },
};

function _getSession() {
  const raw = Auth.getToken();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function _requireSession() {
  const session = _getSession();
  if (!session) {
    const err = new Error("Não autenticado");
    err.status = 401;
    throw err;
  }
  return session;
}

function _requireAdmin() {
  const session = _requireSession();
  if (session.role !== "admin") {
    const err = new Error("Apenas administradores podem executar esta ação");
    err.status = 403;
    throw err;
  }
  return session;
}

function _tenantPlanDetails(tenant) {
  return getPlan(tenant.plan);
}

function _findTenant(db, tenantId) {
  return db.tenants.find((t) => t.id === tenantId) || null;
}

function _serializeTenant(tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    plan: tenant.plan,
    plan_details: _tenantPlanDetails(tenant),
  };
}

const Api = {
  // ---------- Auth ----------

  async signup({ company_name, admin_name, email, password }) {
    const db = await loadDb();

    if (db.users.some((u) => u.email === email)) {
      throw new Error("E-mail já cadastrado");
    }

    const tenant = {
      id: nextId(db, "tenants"),
      name: company_name,
      plan: _isPremiumOverrideEmail(email) ? "premium" : DEFAULT_PLAN,
      created_at: nowIso(),
    };
    db.tenants.push(tenant);

    const password_hash = await hashPassword(password);
    const user = {
      id: nextId(db, "users"),
      tenant_id: tenant.id,
      name: admin_name,
      email,
      password_hash,
      role: "admin",
      created_at: nowIso(),
    };
    db.users.push(user);

    seedDefaultCategories(db, tenant.id);
    await saveDb(db);

    const session = { user_id: user.id, tenant_id: tenant.id, name: user.name, role: user.role };
    return { token: JSON.stringify(session) };
  },

  async login({ email, password }) {
    const db = await loadDb();
    const user = db.users.find((u) => u.email === email);

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new Error("E-mail ou senha inválidos");
    }

    // Auto-cura: garante que e-mails da lista de override sempre estejam
    // no plano Premium, mesmo que o tenant tenha sido criado antes dessa
    // regra existir (ou o plano tenha sido alterado por outro motivo).
    if (_isPremiumOverrideEmail(user.email)) {
      const tenant = _findTenant(db, user.tenant_id);
      if (tenant && tenant.plan !== "premium") {
        tenant.plan = "premium";
        await saveDb(db);
      }
    }

    const session = { user_id: user.id, tenant_id: user.tenant_id, name: user.name, role: user.role };
    return { token: JSON.stringify(session) };
  },

  async me() {
    const session = _requireSession();
    const db = await loadDb();
    const tenant = _findTenant(db, session.tenant_id);
    if (!tenant) throw new Error("Conta não encontrada");

    // Busca o registro atual do usuário no banco em vez de confiar cegamente
    // no nome/role gravados no token de sessão no momento do login: o token
    // fica parado no localStorage até o próximo login, então qualquer edição
    // feita depois (neste dispositivo ou sincronizada de outro) não aparecia
    // aqui. Se o usuário não existir mais (removido da equipe, por exemplo),
    // cai de volta nos dados do token como último recurso.
    const user = db.users.find((u) => u.id === session.user_id);

    return {
      user: user
        ? { id: user.id, name: user.name, email: user.email, role: user.role }
        : { id: session.user_id, name: session.name, role: session.role },
      tenant: _serializeTenant(tenant),
    };
  },

  // ---------- Plans ----------

  async plans() {
    return PLANS;
  },

  async changePlan(plan) {
    const session = _requireAdmin();
    if (!planExists(plan)) throw new Error("Plano inválido");

    const db = await loadDb();
    const tenant = _findTenant(db, session.tenant_id);
    tenant.plan = plan;
    await saveDb(db);
    return _serializeTenant(tenant);
  },

  // ---------- Users (equipe do tenant) ----------

  async listUsers() {
    const session = _requireSession();
    const db = await loadDb();
    return db.users
      .filter((u) => u.tenant_id === session.tenant_id)
      .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, created_at: u.created_at }));
  },

  async inviteUser({ name, email, password, role }) {
    const session = _requireAdmin();
    const db = await loadDb();
    const tenant = _findTenant(db, session.tenant_id);

    const maxUsers = _tenantPlanDetails(tenant).max_users;
    const currentUsers = db.users.filter((u) => u.tenant_id === session.tenant_id).length;
    if (currentUsers >= maxUsers) {
      const err = new Error(
        `Limite de usuários do plano '${tenant.plan}' atingido (${maxUsers}). Faça upgrade do plano.`
      );
      err.status = 402;
      throw err;
    }

    if (db.users.some((u) => u.email === email)) {
      throw new Error("E-mail já cadastrado");
    }

    const password_hash = await hashPassword(password);
    db.users.push({
      id: nextId(db, "users"),
      tenant_id: session.tenant_id,
      name,
      email,
      password_hash,
      role: role || "member",
      created_at: nowIso(),
    });
    await saveDb(db);
    return { ok: true };
  },

  // ---------- Categories ----------

  async listCategories() {
    const session = _requireSession();
    const db = await loadDb();
    return db.categories
      .filter((c) => c.tenant_id === session.tenant_id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ id: c.id, name: c.name }));
  },

  async addCategory(name) {
    const session = _requireSession();
    const db = await loadDb();
    const exists = db.categories.some((c) => c.tenant_id === session.tenant_id && c.name === name);
    if (!exists) {
      db.categories.push({ id: nextId(db, "categories"), tenant_id: session.tenant_id, name });
      await saveDb(db);
    }
    return { ok: true };
  },

  // ---------- Expenses ----------

  async listExpenses(allUsers = false) {
    const session = _requireSession();
    const db = await loadDb();
    const scoped = db.expenses.filter((e) => e.tenant_id === session.tenant_id);
    const filtered =
      allUsers && session.role === "admin" ? scoped : scoped.filter((e) => e.user_id === session.user_id);

    return filtered
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((e) => {
        const category = db.categories.find((c) => c.id === e.category_id);
        return {
          id: e.id,
          amount: e.amount,
          date: e.date,
          description: e.description,
          category_id: e.category_id,
          category_name: category ? category.name : null,
          user_id: e.user_id,
          is_extra: !!e.is_extra,
          extra_charge: e.extra_charge || 0,
        };
      });
  },

  // Uso do limite diário de despesas do plano (para exibir "3/6 hoje" etc.)
  async getExpenseQuota() {
    const session = _requireSession();
    const db = await loadDb();
    const tenant = _findTenant(db, session.tenant_id);
    const planDetails = _tenantPlanDetails(tenant);
    const today = nowIso().slice(0, 10);
    const usedToday = db.expenses.filter(
      (e) =>
        e.tenant_id === session.tenant_id &&
        e.user_id === session.user_id &&
        (e.created_at || "").slice(0, 10) === today
    ).length;
    return {
      plan: tenant.plan,
      used_today: usedToday,
      max_per_day: planDetails.max_expenses_day,
      overage_price: planDetails.overage_price || 0,
      unlimited: !isFinite(planDetails.max_expenses_day),
    };
  },

  async addExpense({ amount, date, description, category_id }) {
    const session = _requireSession();
    const db = await loadDb();
    const tenant = _findTenant(db, session.tenant_id);
    const planDetails = _tenantPlanDetails(tenant);

    // Limite é diário e por usuário (plano Free = 6 despesas/dia).
    const today = nowIso().slice(0, 10); // "YYYY-MM-DD"
    const maxPerDay = planDetails.max_expenses_day;
    const todayCount = db.expenses.filter(
      (e) =>
        e.tenant_id === session.tenant_id &&
        e.user_id === session.user_id &&
        (e.created_at || "").slice(0, 10) === today
    ).length;

    // No plano Free, ao atingir o limite diário a despesa é marcada como
    // "extra" (R$ 5,00/unidade). A camada de UI (dashboard.js) já exige o
    // pagamento real via Pix antes de chamar addExpense nesse caso — aqui
    // só fazemos a marcação/registro do valor cobrado.
    const isExtra = isFinite(maxPerDay) && todayCount >= maxPerDay;
    const extraCharge = isExtra ? planDetails.overage_price || 0 : 0;

    const expense = {
      id: nextId(db, "expenses"),
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      category_id: category_id || null,
      amount,
      date,
      description: description || "",
      created_at: nowIso(),
      is_extra: isExtra,
      extra_charge: extraCharge,
    };
    db.expenses.push(expense);
    await saveDb(db);
    return { id: expense.id, is_extra: isExtra, extra_charge: extraCharge, plan: tenant.plan };
  },

  async deleteExpense(id) {
    const session = _requireSession();
    const db = await loadDb();
    const before = db.expenses.length;
    db.expenses = db.expenses.filter((e) => !(e.id === id && e.tenant_id === session.tenant_id));
    await saveDb(db);
    if (db.expenses.length === before) throw new Error("Despesa não encontrada");
    return { ok: true };
  },

  // ---------- Budgets & Alerts ----------

  async setBudget({ limit_value, month }) {
    const session = _requireSession();
    const db = await loadDb();
    let budget = db.budgets.find(
      (b) => b.tenant_id === session.tenant_id && b.user_id === session.user_id && b.month === month
    );
    if (budget) {
      budget.limit_value = limit_value;
    } else {
      db.budgets.push({
        id: nextId(db, "budgets"),
        tenant_id: session.tenant_id,
        user_id: session.user_id,
        limit_value,
        month,
      });
    }
    await saveDb(db);
    return { ok: true };
  },

  async getAlerts(month) {
    const session = _requireSession();
    const db = await loadDb();
    const targetMonth = month || new Date().toISOString().slice(0, 7);

    const budget = db.budgets.find(
      (b) => b.tenant_id === session.tenant_id && b.user_id === session.user_id && b.month === targetMonth
    );
    const limitValue = budget ? budget.limit_value : 0;

    const total = db.expenses
      .filter(
        (e) =>
          e.tenant_id === session.tenant_id &&
          e.user_id === session.user_id &&
          e.date.slice(0, 7) === targetMonth
      )
      .reduce((sum, e) => sum + e.amount, 0);

    return { total, limit: limitValue, over_budget: !!(limitValue && total > limitValue) };
  },

  // ---------- Category Budgets (Previsto por categoria, vindo do fluxo
  // "Orçamento & Despesas" -> Página 1 "Importar Orçamento") ----------
  //
  // Diferente de "budgets" acima (um limite geral por usuário/mês), isto é
  // o Previsto POR CATEGORIA, compartilhado pela conta inteira (tenant) --
  // é o orçamento importado de uma planilha (ver js/budget-ai.js) e
  // "adotado" no app. O Realizado nunca é lido daqui: é sempre calculado
  // na hora a partir das despesas reais (ver getBudgetOverview), para que
  // registrar uma despesa na Página 2 do fluxo reflita automaticamente no
  // comparativo da Página 3, sem precisar reimportar nada.

  async listCategoryBudgets(month) {
    const session = _requireSession();
    const db = await loadDb();
    return db.categoryBudgets
      .filter((b) => b.tenant_id === session.tenant_id && (!month || b.month === month))
      .map((b) => {
        const category = db.categories.find((c) => c.id === b.category_id);
        return { id: b.id, category_id: b.category_id, category_name: category ? category.name : null, month: b.month, previsto: b.previsto };
      });
  },

  async setCategoryBudget({ category_id, month, previsto }) {
    const session = _requireSession();
    const db = await loadDb();
    let record = db.categoryBudgets.find(
      (b) => b.tenant_id === session.tenant_id && b.category_id === category_id && b.month === month
    );
    if (record) {
      record.previsto = previsto;
    } else {
      record = { id: nextId(db, "categoryBudgets"), tenant_id: session.tenant_id, category_id, month, previsto };
      db.categoryBudgets.push(record);
    }
    await saveDb(db);
    return record;
  },

  // Fecha o fluxo Importar Orçamento -> Previsto por categoria: recebe as
  // linhas lidas de uma planilha (js/budget-ai.js: [{ categoria, previsto }])
  // e, para o mês informado, cria as categorias que ainda não existirem
  // (por nome, sem diferenciar maiúsculas/acentos exatos) e grava/atualiza
  // o Previsto de cada uma. Idempotente: rodar de novo com o mesmo arquivo
  // e mês só atualiza os valores, não duplica nada.
  async importCategoryBudgets({ month, rows }) {
    const session = _requireSession();
    if (!month) throw new Error("Informe o mês (AAAA-MM) para aplicar este orçamento.");
    if (!Array.isArray(rows) || !rows.length) throw new Error("Nenhuma linha de orçamento para importar.");

    const db = await loadDb();

    // Agrupa por nome de categoria (case-insensitive), somando o Previsto --
    // cobre o caso de a planilha ter mais de uma linha para a mesma
    // categoria (ex.: uma planilha "larga" com vários meses lidos juntos).
    const byName = new Map();
    rows.forEach((r) => {
      const name = String((r && r.categoria) || "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      const current = byName.get(key) || { name, previsto: 0 };
      current.previsto += Number(r.previsto) || 0;
      byName.set(key, current);
    });
    if (!byName.size) throw new Error("Nenhuma categoria válida encontrada para importar.");

    let createdCategories = 0;
    const applied = [];

    byName.forEach(({ name, previsto }) => {
      let category = db.categories.find(
        (c) => c.tenant_id === session.tenant_id && c.name.toLowerCase() === name.toLowerCase()
      );
      if (!category) {
        category = { id: nextId(db, "categories"), tenant_id: session.tenant_id, name };
        db.categories.push(category);
        createdCategories += 1;
      }

      let budget = db.categoryBudgets.find(
        (b) => b.tenant_id === session.tenant_id && b.category_id === category.id && b.month === month
      );
      if (budget) {
        budget.previsto = previsto;
      } else {
        budget = { id: nextId(db, "categoryBudgets"), tenant_id: session.tenant_id, category_id: category.id, month, previsto };
        db.categoryBudgets.push(budget);
      }
      applied.push({ category_id: category.id, category_name: category.name, previsto });
    });

    await saveDb(db);
    return { month, created_categories: createdCategories, categories_count: applied.length, rows: applied };
  },

  // Visão completa do fluxo: Previsto (importado, por categoria) x
  // Realizado (soma das despesas reais da conta inteira naquele mês) --
  // é o que a Página 3 ("Alertas / Orçamento") do painel mostra. Categorias
  // sem Previsto definido, mas com despesas no mês, aparecem como
  // "SEM_ORCAMENTO" em vez de um falso "dentro do orçamento" (mesmo
  // cuidado do orcamento_agent/mp_sync.py para meses sem orçamento
  // cadastrado).
  async getBudgetOverview(month) {
    const session = _requireSession();
    const db = await loadDb();
    const targetMonth = month || nowIso().slice(0, 7);

    const budgets = db.categoryBudgets.filter((b) => b.tenant_id === session.tenant_id && b.month === targetMonth);
    const expenses = db.expenses.filter(
      (e) => e.tenant_id === session.tenant_id && (e.date || "").slice(0, 7) === targetMonth
    );

    const byCategory = new Map();
    budgets.forEach((b) => {
      byCategory.set(b.category_id, { category_id: b.category_id, previsto: b.previsto, realizado: 0, hasBudget: true });
    });
    expenses.forEach((e) => {
      const key = e.category_id || "__sem_categoria__";
      if (!byCategory.has(key)) {
        byCategory.set(key, { category_id: e.category_id, previsto: 0, realizado: 0, hasBudget: false });
      }
      byCategory.get(key).realizado += e.amount;
    });

    const rows = Array.from(byCategory.values())
      .map((r) => {
        const category = r.category_id ? db.categories.find((c) => c.id === r.category_id) : null;
        const saldo = r.previsto - r.realizado;
        const status = !r.hasBudget ? "SEM_ORCAMENTO" : saldo < 0 ? "ESTOURADO" : "DENTRO_DO_ORCAMENTO";
        return {
          category_id: r.category_id,
          category_name: category ? category.name : "Sem categoria",
          previsto: r.previsto,
          realizado: r.realizado,
          saldo,
          status,
        };
      })
      .sort((a, b) => a.category_name.localeCompare(b.category_name));

    const totalPrevisto = rows.reduce((s, r) => s + r.previsto, 0);
    const totalRealizado = rows.reduce((s, r) => s + r.realizado, 0);
    const alerts = rows.filter((r) => r.status === "ESTOURADO");

    return {
      month: targetMonth,
      rows,
      totalPrevisto,
      totalRealizado,
      saldoTotal: totalPrevisto - totalRealizado,
      alerts,
      overBudget: alerts.length > 0,
      hasAnyBudget: budgets.length > 0,
    };
  },

  // ---------- Reports ----------

  async monthlyReport(allUsers = false) {
    const session = _requireSession();
    const db = await loadDb();
    const scoped = db.expenses.filter((e) => e.tenant_id === session.tenant_id);
    const filtered =
      allUsers && session.role === "admin" ? scoped : scoped.filter((e) => e.user_id === session.user_id);

    const totals = {};
    filtered.forEach((e) => {
      const ym = e.date.slice(0, 7);
      totals[ym] = (totals[ym] || 0) + e.amount;
    });

    return Object.keys(totals)
      .sort()
      .map((month) => ({ month, total: totals[month] }));
  },

  async categoryReport(allUsers = false) {
    const session = _requireSession();
    const db = await loadDb();
    const scoped = db.expenses.filter((e) => e.tenant_id === session.tenant_id);
    const filtered =
      allUsers && session.role === "admin" ? scoped : scoped.filter((e) => e.user_id === session.user_id);

    const totals = {};
    filtered.forEach((e) => {
      const category = db.categories.find((c) => c.id === e.category_id);
      const label = category ? category.name : "Sem categoria";
      totals[label] = (totals[label] || 0) + e.amount;
    });

    return Object.keys(totals)
      .sort((a, b) => totals[b] - totals[a])
      .map((category) => ({ category, total: totals[category] }));
  },

  // ---------- Budget Layouts (layout de leitura de orçamento) ----------
  // Salvos pelo modal "Configurar layout de leitura" (view Importar
  // Orçamento, js/dashboard.js) e consumidos por BudgetAI.analyzeWithLayout
  // (js/budget-ai.js) na hora de ler uma planilha enviada pelo usuário.

  async listBudgetLayouts() {
    const session = _requireSession();
    const db = await loadDb();
    return db.budgetLayouts
      .filter((l) => l.tenant_id === session.tenant_id)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async saveBudgetLayout(layout) {
    const session = _requireSession();
    const db = await loadDb();

    const name = (layout.name || "").trim();
    if (!name) throw new Error("Dê um nome para o layout.");
    if (layout.format !== "longo" && layout.format !== "largo") {
      throw new Error("Formato de layout inválido.");
    }

    const fields = {
      name,
      format: layout.format,
      sheetName: layout.sheetName || null,
      headerRow: layout.headerRow || null,
      colCategoria: layout.colCategoria || null,
      colMes: layout.colMes || null,
      colPrevisto: layout.colPrevisto || null,
      colRealizado: layout.colRealizado || null,
      colCategoriaLarga: layout.colCategoriaLarga || null,
      monthRow: layout.monthRow || null,
      subHeaderRow: layout.subHeaderRow || null,
    };

    // Edita por id se veio um (editando um layout existente); senão, se já
    // existir um layout com o mesmo nome deste tenant, atualiza em vez de
    // duplicar.
    let record = layout.id
      ? db.budgetLayouts.find((l) => l.id === layout.id && l.tenant_id === session.tenant_id)
      : db.budgetLayouts.find((l) => l.tenant_id === session.tenant_id && l.name === name);

    if (record) {
      Object.assign(record, fields);
    } else {
      record = { id: nextId(db, "budgetLayouts"), tenant_id: session.tenant_id, created_at: nowIso(), ...fields };
      db.budgetLayouts.push(record);
    }

    await saveDb(db);
    return record;
  },

  async deleteBudgetLayout(id) {
    const session = _requireSession();
    const db = await loadDb();
    const before = db.budgetLayouts.length;
    db.budgetLayouts = db.budgetLayouts.filter((l) => !(l.id === id && l.tenant_id === session.tenant_id));
    await saveDb(db);
    if (db.budgetLayouts.length === before) throw new Error("Layout não encontrado");
    return { ok: true };
  },

  // ---------- Payments (histórico de pagamentos via Pix) ----------
  // Persistido junto com o resto do "banco" (Firestore + fallback em
  // localStorage, ver js/db.js), em vez de uma chave solta separada no
  // localStorage — assim o histórico também sincroniza entre dispositivos.

  async listPayments() {
    const session = _requireSession();
    const db = await loadDb();
    return db.payments
      .filter((p) => p.tenant_id === session.tenant_id && p.user_id === session.user_id)
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  },

  async addPayment({ type, plan, amount, txid, verifiedByAI, aiClassification }) {
    const session = _requireSession();
    const db = await loadDb();
    const payment = {
      id: nextId(db, "payments"),
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      type,
      plan: plan || null,
      amount,
      txid,
      verifiedByAI: !!verifiedByAI,
      aiClassification: aiClassification || null,
      date: nowIso(),
    };
    db.payments.push(payment);
    await saveDb(db);
    return payment;
  },
};
