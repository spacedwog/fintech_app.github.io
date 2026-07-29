# ===============================
# backend/services/report_service.py (multi-tenant)
# ===============================
from database import get_connection


class ReportService:

    @staticmethod
    def monthly_summary(tenant_id, user_id=None):
        conn = get_connection()
        cursor = conn.cursor()
        if user_id:
            cursor.execute(
                """SELECT strftime('%Y-%m', date) as ym, SUM(amount) as total
                   FROM expenses WHERE tenant_id = ? AND user_id = ?
                   GROUP BY ym ORDER BY ym""",
                (tenant_id, user_id),
            )
        else:
            cursor.execute(
                """SELECT strftime('%Y-%m', date) as ym, SUM(amount) as total
                   FROM expenses WHERE tenant_id = ?
                   GROUP BY ym ORDER BY ym""",
                (tenant_id,),
            )
        rows = [{"month": r["ym"], "total": r["total"]} for r in cursor.fetchall()]
        conn.close()
        return rows

    @staticmethod
    def by_category(tenant_id, user_id=None):
        conn = get_connection()
        cursor = conn.cursor()
        if user_id:
            cursor.execute(
                """SELECT c.name as category, SUM(e.amount) as total
                   FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
                   WHERE e.tenant_id = ? AND e.user_id = ?
                   GROUP BY c.name ORDER BY total DESC""",
                (tenant_id, user_id),
            )
        else:
            cursor.execute(
                """SELECT c.name as category, SUM(e.amount) as total
                   FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
                   WHERE e.tenant_id = ?
                   GROUP BY c.name ORDER BY total DESC""",
                (tenant_id,),
            )
        rows = [{"category": r["category"] or "Sem categoria", "total": r["total"]} for r in cursor.fetchall()]
        conn.close()
        return rows

    @staticmethod
    def check_budget(tenant_id, user_id, month, limit_value):
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT SUM(amount) as total FROM expenses
               WHERE tenant_id = ? AND user_id = ? AND strftime('%Y-%m', date) = ?""",
            (tenant_id, user_id, month),
        )
        total = cursor.fetchone()["total"] or 0
        conn.close()
        return {
            "total": total,
            "limit": limit_value,
            "over_budget": bool(limit_value and total > limit_value),
        }
