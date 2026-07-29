# ===============================
# backend/main.py
# FastAPI REST API - Fintech SaaS (multi-tenant)
# ===============================
from datetime import date as date_cls
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field

from database import create_tables
from auth import create_token, decode_token, TokenError
from plans import PLANS
from services.tenant_service import TenantService
from services.expense_service import ExpenseService
from services.category_service import CategoryService
from services.budget_service import BudgetService
from services.report_service import ReportService

create_tables()

app = FastAPI(title="Fintech SaaS API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ajuste para o domínio do frontend em produção
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

bearer_scheme = HTTPBearer()


# ---------- Auth dependency ----------

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    token = credentials.credentials
    try:
        payload = decode_token(token)
    except TokenError as e:
        raise HTTPException(status_code=401, detail=str(e))
    return payload  # {user_id, tenant_id, name, role, exp}


def require_admin(user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Apenas administradores podem executar esta ação")
    return user


# ---------- Schemas ----------

class SignupRequest(BaseModel):
    company_name: str = Field(min_length=1)
    admin_name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=6)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class InviteUserRequest(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    role: str = "member"


class ExpenseCreate(BaseModel):
    amount: float = Field(gt=0)
    date: str  # "YYYY-MM-DD"
    description: str = ""
    category_id: Optional[int] = None


class CategoryCreate(BaseModel):
    name: str


class BudgetSet(BaseModel):
    limit_value: float = Field(ge=0)
    month: str  # "YYYY-MM"


class PlanChange(BaseModel):
    plan: str


# ---------- Auth routes ----------

@app.post("/api/auth/signup")
def signup(body: SignupRequest):
    try:
        result = TenantService.signup(body.company_name, body.admin_name, body.email, body.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    token = create_token({
        "user_id": result["user_id"],
        "tenant_id": result["tenant_id"],
        "name": body.admin_name,
        "role": result["role"],
    })
    return {"token": token}


@app.post("/api/auth/login")
def login(body: LoginRequest):
    result = TenantService.login(body.email, body.password)
    if not result:
        raise HTTPException(status_code=401, detail="E-mail ou senha inválidos")

    token = create_token({
        "user_id": result["user_id"],
        "tenant_id": result["tenant_id"],
        "name": result["name"],
        "role": result["role"],
    })
    return {"token": token}


@app.get("/api/me")
def me(user=Depends(get_current_user)):
    tenant = TenantService.get_tenant(user["tenant_id"])
    return {
        "user": {"id": user["user_id"], "name": user["name"], "role": user["role"]},
        "tenant": tenant,
    }


# ---------- Plans ----------

@app.get("/api/plans")
def list_plans():
    return PLANS


@app.post("/api/tenant/plan")
def change_plan(body: PlanChange, user=Depends(require_admin)):
    try:
        tenant = TenantService.change_plan(user["tenant_id"], body.plan)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return tenant


# ---------- Users (tenant team) ----------

@app.get("/api/users")
def list_users(user=Depends(get_current_user)):
    return TenantService.list_users(user["tenant_id"])


@app.post("/api/users/invite")
def invite_user(body: InviteUserRequest, user=Depends(require_admin)):
    try:
        TenantService.invite_user(user["tenant_id"], body.name, body.email, body.password, body.role)
    except PermissionError as e:
        raise HTTPException(status_code=402, detail=str(e))  # 402 Payment Required (limite de plano)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


# ---------- Categories ----------

@app.get("/api/categories")
def list_categories(user=Depends(get_current_user)):
    return CategoryService.list_categories(user["tenant_id"])


@app.post("/api/categories")
def add_category(body: CategoryCreate, user=Depends(get_current_user)):
    CategoryService.add_category(user["tenant_id"], body.name)
    return {"ok": True}


# ---------- Expenses ----------

@app.get("/api/expenses")
def get_expenses(user=Depends(get_current_user), all_users: bool = False):
    if all_users and user["role"] == "admin":
        return ExpenseService.get_expenses(user["tenant_id"])
    return ExpenseService.get_expenses(user["tenant_id"], user["user_id"])


@app.post("/api/expenses")
def add_expense(body: ExpenseCreate, user=Depends(get_current_user)):
    try:
        expense_id = ExpenseService.add_expense(
            user["tenant_id"], user["user_id"], body.category_id, body.amount, body.date, body.description
        )
    except PermissionError as e:
        raise HTTPException(status_code=402, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"id": expense_id}


@app.delete("/api/expenses/{expense_id}")
def delete_expense(expense_id: int, user=Depends(get_current_user)):
    ok = ExpenseService.delete_expense(user["tenant_id"], expense_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Despesa não encontrada")
    return {"ok": True}


# ---------- Budgets & Alerts ----------

@app.post("/api/budgets")
def set_budget(body: BudgetSet, user=Depends(get_current_user)):
    BudgetService.set_budget(user["tenant_id"], user["user_id"], body.limit_value, body.month)
    return {"ok": True}


@app.get("/api/alerts")
def alerts(user=Depends(get_current_user), month: Optional[str] = None):
    month = month or date_cls.today().strftime("%Y-%m")
    limit_value = BudgetService.get_budget(user["tenant_id"], user["user_id"], month)
    return ReportService.check_budget(user["tenant_id"], user["user_id"], month, limit_value or 0)


# ---------- Reports ----------

@app.get("/api/reports/monthly")
def monthly_report(user=Depends(get_current_user), all_users: bool = False):
    if all_users and user["role"] == "admin":
        return ReportService.monthly_summary(user["tenant_id"])
    return ReportService.monthly_summary(user["tenant_id"], user["user_id"])


@app.get("/api/reports/by-category")
def category_report(user=Depends(get_current_user), all_users: bool = False):
    if all_users and user["role"] == "admin":
        return ReportService.by_category(user["tenant_id"])
    return ReportService.by_category(user["tenant_id"], user["user_id"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
