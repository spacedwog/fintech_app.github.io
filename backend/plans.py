# ===============================
# backend/plans.py
# Definição dos planos SaaS e seus limites
# ===============================

PLANS = {
    "free": {
        "label": "Free",
        "price_month": 0,
        "max_users": 3,
        "max_expenses_month": 50,
    },
    "pro": {
        "label": "Pro",
        "price_month": 49.90,
        "max_users": 20,
        "max_expenses_month": 2000,
    },
    "enterprise": {
        "label": "Enterprise",
        "price_month": 199.90,
        "max_users": 10_000,
        "max_expenses_month": 1_000_000,
    },
}

DEFAULT_PLAN = "free"


def get_plan(plan_key: str) -> dict:
    return PLANS.get(plan_key, PLANS[DEFAULT_PLAN])


def plan_exists(plan_key: str) -> bool:
    return plan_key in PLANS
