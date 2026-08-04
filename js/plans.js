// ===============================
// frontend/js/plans.js
// Definição dos planos do usuário e seus limites (100% client-side)
// ===============================
//
// Regras de negócio:
// - Free: acesso completo ao sistema, mas limitado a 6 despesas/dia.
//   Cada despesa que exceder esse limite diário exige um pagamento real
//   via Pix (QR Code/copia-e-cola gerado com a chave Pix da SPACECWORP)
//   de R$ 5,00/unidade antes de ser registrada — ver js/pix.js e
//   openPixPayment() em dashboard.js.
// - Premium: acesso completo ao sistema, com despesas ilimitadas,
//   por R$ 19,99/mês (também pago via Pix real).

const PLANS = {
  free: {
    label: "Free",
    price_month: 0,
    max_users: Infinity,
    max_expenses_day: 6,
    overage_price: 5.0, // cobrança real via Pix por despesa extra além do limite diário
  },
  premium: {
    label: "Premium",
    price_month: 19.99,
    max_users: Infinity,
    max_expenses_day: Infinity,
    overage_price: 0,
  },
};

const DEFAULT_PLAN = "free";

function getPlan(planKey) {
  return PLANS[planKey] || PLANS[DEFAULT_PLAN];
}

function planExists(planKey) {
  return Object.prototype.hasOwnProperty.call(PLANS, planKey);
}
