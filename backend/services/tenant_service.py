# ===============================
# backend/services/tenant_service.py
# ===============================
from database import get_connection, seed_default_categories
from auth import hash_password, verify_password
from plans import DEFAULT_PLAN, get_plan, plan_exists


class TenantService:

    @staticmethod
    def signup(company_name: str, admin_name: str, email: str, password: str):
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
        if cursor.fetchone():
            conn.close()
            raise ValueError("E-mail já cadastrado")

        cursor.execute(
            "INSERT INTO tenants (name, plan) VALUES (?, ?)",
            (company_name, DEFAULT_PLAN),
        )
        tenant_id = cursor.lastrowid

        password_hash = hash_password(password)
        cursor.execute(
            """INSERT INTO users (tenant_id, name, email, password_hash, role)
               VALUES (?, ?, ?, ?, 'admin')""",
            (tenant_id, admin_name, email, password_hash),
        )
        user_id = cursor.lastrowid

        conn.commit()
        conn.close()

        seed_default_categories(tenant_id)

        return {"tenant_id": tenant_id, "user_id": user_id, "role": "admin"}

    @staticmethod
    def login(email: str, password: str):
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, tenant_id, name, password_hash, role FROM users WHERE email = ?",
            (email,),
        )
        row = cursor.fetchone()
        conn.close()

        if not row or not verify_password(password, row["password_hash"]):
            return None

        return {
            "user_id": row["id"],
            "tenant_id": row["tenant_id"],
            "name": row["name"],
            "role": row["role"],
        }

    @staticmethod
    def get_tenant(tenant_id: int):
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, plan FROM tenants WHERE id = ?", (tenant_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        plan = get_plan(row["plan"])
        return {"id": row["id"], "name": row["name"], "plan": row["plan"], "plan_details": plan}

    @staticmethod
    def count_users(tenant_id: int) -> int:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as c FROM users WHERE tenant_id = ?", (tenant_id,))
        c = cursor.fetchone()["c"]
        conn.close()
        return c

    @staticmethod
    def count_expenses_this_month(tenant_id: int, year_month: str) -> int:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) as c FROM expenses WHERE tenant_id = ? AND strftime('%Y-%m', date) = ?",
            (tenant_id, year_month),
        )
        c = cursor.fetchone()["c"]
        conn.close()
        return c

    @staticmethod
    def invite_user(tenant_id: int, name: str, email: str, password: str, role: str = "member"):
        tenant = TenantService.get_tenant(tenant_id)
        if not tenant:
            raise ValueError("Tenant não encontrado")

        max_users = tenant["plan_details"]["max_users"]
        current_users = TenantService.count_users(tenant_id)
        if current_users >= max_users:
            raise PermissionError(
                f"Limite de usuários do plano '{tenant['plan']}' atingido ({max_users}). Faça upgrade do plano."
            )

        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
        if cursor.fetchone():
            conn.close()
            raise ValueError("E-mail já cadastrado")

        password_hash = hash_password(password)
        cursor.execute(
            """INSERT INTO users (tenant_id, name, email, password_hash, role)
               VALUES (?, ?, ?, ?, ?)""",
            (tenant_id, name, email, password_hash, role),
        )
        conn.commit()
        conn.close()
        return {"ok": True}

    @staticmethod
    def list_users(tenant_id: int):
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, email, role, created_at FROM users WHERE tenant_id = ? ORDER BY id",
            (tenant_id,),
        )
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return rows

    @staticmethod
    def change_plan(tenant_id: int, new_plan: str):
        if not plan_exists(new_plan):
            raise ValueError("Plano inválido")
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE tenants SET plan = ? WHERE id = ?", (new_plan, tenant_id))
        conn.commit()
        conn.close()
        return TenantService.get_tenant(tenant_id)
