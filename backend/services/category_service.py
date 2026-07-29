# ===============================
# backend/services/category_service.py
# ===============================
from database import get_connection


class CategoryService:

    @staticmethod
    def list_categories(tenant_id):
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name FROM categories WHERE tenant_id = ? ORDER BY name", (tenant_id,)
        )
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return rows

    @staticmethod
    def add_category(tenant_id, name):
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR IGNORE INTO categories (tenant_id, name) VALUES (?, ?)",
            (tenant_id, name),
        )
        conn.commit()
        conn.close()
