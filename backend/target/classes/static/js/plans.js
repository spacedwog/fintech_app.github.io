// ===============================
// frontend/js/plans.js
// Definição dos planos do usuário e seus limites (100% client-side)
// ===============================
//
// Regras de negócio:
// - Free: acesso completo ao sistema, mas limitado a 6 despesas/dia
//   e 3 importações de orçamento/dia.
//   Cada despesa que exceder esse limite diário exige um pagamento real
//   via Pix (QR Code/copia-e-cola gerado com a chave Pix da SPACECWORP)
//   de R$ 5,00/unidade antes de ser registrada — ver js/pix.js e
//   openPixPayment() em dashboard.js.
// - Premium: acesso completo ao sistema, com despesas e importações
//   de orçamento ilimitadas,
//   por R$ 19,99/mês (também pago via Pix real).
//
// Reescrito em POO: Plan (entidade, um plano) + PlanCatalog (coleção de
// planos, encapsula busca/validação). As funções/constantes globais
// (PLANS, DEFAULT_PLAN, getPlan, planExists) continuam existindo, agora
// como uma fina camada de compatibilidade sobre o catálogo — o resto do
// sistema (js/api.js, js/dashboard.js, tests/*.test.js) não precisa mudar.

class Plan {
  constructor(
    key,
    { label, price_month, max_users, max_expenses_day, max_budget_imports_day, overage_price, budget_import_overage_price }
  ) {
    this.key = key;
    this.label = label;
    this.price_month = price_month;
    this.max_users = max_users;
    this.max_expenses_day = max_expenses_day;
    this.max_budget_imports_day = max_budget_imports_day;
    this.overage_price = overage_price || 0;
    this.budget_import_overage_price = budget_import_overage_price || 0;
  }

  get hasUnlimitedExpenses() {
    return !isFinite(this.max_expenses_day);
  }

  get hasUnlimitedUsers() {
    return !isFinite(this.max_users);
  }

  get hasUnlimitedBudgetImports() {
    return !isFinite(this.max_budget_imports_day);
  }

  // Quanto custa registrar mais uma despesa além do limite diário (0 se
  // o plano já é ilimitado ou não cobra excedente).
  overageChargeFor(usedToday) {
    if (this.hasUnlimitedExpenses) return 0;
    return usedToday >= this.max_expenses_day ? this.overage_price : 0;
  }

  // Formato plano (mesma shape do antigo objeto PLANS[key]) — usado por
  // quem espera um objeto simples em vez da instância da classe.
  toJSON() {
    return {
      label: this.label,
      price_month: this.price_month,
      max_users: this.max_users,
      max_expenses_day: this.max_expenses_day,
      max_budget_imports_day: this.max_budget_imports_day,
      overage_price: this.overage_price,
      budget_import_overage_price: this.budget_import_overage_price,
    };
  }
}

class PlanCatalog {
  constructor(definitions, defaultKey) {
    this._plans = new Map();
    Object.keys(definitions).forEach((key) => {
      this._plans.set(key, new Plan(key, definitions[key]));
    });
    this.defaultKey = defaultKey;
  }

  has(key) {
    return this._plans.has(key);
  }

  get(key) {
    return this._plans.get(key) || this._plans.get(this.defaultKey);
  }

  get defaultPlan() {
    return this.get(this.defaultKey);
  }

  // Objeto plano { free: {...}, premium: {...} } — mesma shape que
  // Api.plans() sempre devolveu para o front-end (js/dashboard.js).
  toPlainObject() {
    const obj = {};
    this._plans.forEach((plan, key) => {
      obj[key] = plan.toJSON();
    });
    return obj;
  }
}

const PLAN_DEFINITIONS = {
  free: {
    label: "Free",
    price_month: 0,
    max_users: Infinity,
    max_expenses_day: 6,
    max_budget_imports_day: 3,
    overage_price: 5.0, // cobrança real via Pix por despesa extra além do limite diário
    budget_import_overage_price: 10.0, // cobrança real via Pix por importação extra de orçamento além do limite diário
  },
  premium: {
    label: "Premium",
    price_month: 19.99,
    max_users: Infinity,
    max_expenses_day: Infinity,
    max_budget_imports_day: Infinity,
    overage_price: 0,
    budget_import_overage_price: 0,
  },
};

const DEFAULT_PLAN = "free";

const PlanCatalogInstance = new PlanCatalog(PLAN_DEFINITIONS, DEFAULT_PLAN);

// ---------- camada de compatibilidade (mesma interface de antes) ----------

const PLANS = PlanCatalogInstance.toPlainObject();

function getPlan(planKey) {
  return PlanCatalogInstance.get(planKey).toJSON();
}

function planExists(planKey) {
  return PlanCatalogInstance.has(planKey);
}
