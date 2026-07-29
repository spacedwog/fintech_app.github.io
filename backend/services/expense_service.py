# ===============================
# backend/services/expense_service.py (multi-tenant)
# ===============================
from database import get_connection
from plans import get_plan
from services.tenant_service import TenantService


class ExpenseService:

    @staticmethod
    def add_expense(tenant_id, user_id, category_id, amount, date, description):
        tenant = TenantService.get_tenant(tenant_id)
        if not tenant:
            raise ValueError("Tenant não encontrado")

        year_month = date[:7]  # "YYYY-MM"
        max_expenses = tenant["plan_details"]["max_expenses_month"]
        current = TenantService.count_expenses_this_month(tenant_id, year_month)
        if current >= max_expenses:
            raise PermissionError(
                f"Limite de {max_expenses} despesas/mês do plano '{tenant['plan']}' atingido. Faça upgrade do plano."
            )

        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO expenses (tenant_id, user_id, category_id, amount, date, description)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (tenant_id, user_id, category_id, amount, date, description),
        )
        conn.commit()
        expense_id = cursor.lastrowid
        conn.close()
        return expense_id

    @staticmethod
    def get_expenses(tenant_id, user_id=None):
        conn = get_connection()
        cursor = conn.cursor()
        if user_id:
            cursor.execute(
                """SELECT e.id, e.amount, e.date, e.description, e.category_id,
                          c.name as category_name, e.user_id
                   FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
                   WHERE e.tenant_id = ? AND e.user_id = ? ORDER BY e.date DESC""",
                (tenant_id, user_id),
            )
        else:
            cursor.execute(
                """SELECT e.id, e.amount, e.date, e.description, e.category_id,
                          c.name as category_name, e.user_id
                   FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
                   WHERE e.tenant_id = ? ORDER BY e.date DESC""",
                (tenant_id,),
            )
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return rows

    @staticmethod
    def delete_expense(tenant_id, expense_id):
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM expenses WHERE id = ? AND tenant_id = ?", (expense_id, tenant_id)
        )
        conn.commit()
        deleted = cursor.rowcount
        conn.close()
        return deleted > 0
