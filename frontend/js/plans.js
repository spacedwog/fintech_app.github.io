// ===============================
// frontend/js/plans.js
// Definição dos planos SaaS e seus limites (100% client-side)
// ===============================

const PLANS = {
  free: {
    label: "Free",
    price_month: 0,
    max_users: 3,
    max_expenses_month: 50,
  },
  pro: {
    label: "Pro",
    price_month: 49.9,
    max_users: 20,
    max_expenses_month: 2000,
  },
  enterprise: {
    label: "Enterprise",
    price_month: 199.9,
    max_users: 10000,
    max_expenses_month: 1000000,
  },
};

const DEFAULT_PLAN = "free";

function getPlan(planKey) {
  return PLANS[planKey] || PLANS[DEFAULT_PLAN];
}

function planExists(planKey) {
  return Object.prototype.hasOwnProperty.call(PLANS, planKey);
}
