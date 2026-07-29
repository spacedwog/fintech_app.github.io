# ===============================
# backend/services/budget_service.py
# ===============================
from database import get_connection


class BudgetService:

    @staticmethod
    def set_budget(tenant_id, user_id, limit_value, month):
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO budgets (tenant_id, user_id, limit_value, month)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(tenant_id, user_id, month)
               DO UPDATE SET limit_value = excluded.limit_value""",
            (tenant_id, user_id, limit_value, month),
        )
        conn.commit()
        conn.close()

    @staticmethod
    def get_budget(tenant_id, user_id, month):
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT limit_value FROM budgets WHERE tenant_id = ? AND user_id = ? AND month = ?",
            (tenant_id, user_id, month),
        )
        row = cursor.fetchone()
        conn.close()
        return row["limit_value"] if row else None
