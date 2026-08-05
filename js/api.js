// ===============================
// frontend/js/api.js
// Camada de "API" 100% client-side (sem servidor, sem Python).
// Mantém a mesma interface que o antigo client REST usava, mas toda
// a lógica de negócio (antes em FastAPI) roda aqui, no navegador,
// persistindo em localStorage via db.js.
//
// AVISO: como não há servidor, o isolamento entre "empresas" (tenants)
// é apenas lógico/organizacional dentro do mesmo navegador — não é uma
// fronteira de segurança real. Qualquer pessoa com acesso ao navegador
// pode inspecionar o localStorage.
// ===============================

const SESSION_KEY = "fintech_saas_session_v1";

// E-mails que sempre têm a empresa (tenant) no plano Premium, sem precisar
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
    if (!tenant) throw new Error("Empresa não encontrada");

    return {
      user: { id: session.user_id, name: session.name, role: session.role },
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
};
