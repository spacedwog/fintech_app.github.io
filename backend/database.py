# ===============================
# backend/database.py
# SQLite connection + multi-tenant schema
# ===============================
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "fintech_saas.db")


def get_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def create_tables():
    conn = get_connection()
    cursor = conn.cursor()

    # Tenants = empresas/contas (isolamento SaaS)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id)
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        UNIQUE(tenant_id, name),
        FOREIGN KEY(tenant_id) REFERENCES tenants(id)
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        category_id INTEGER,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(category_id) REFERENCES categories(id)
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        limit_value REAL NOT NULL,
        month TEXT NOT NULL,
        UNIQUE(tenant_id, user_id, month),
        FOREIGN KEY(tenant_id) REFERENCES tenants(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
    """)

    conn.commit()
    conn.close()


def seed_default_categories(tenant_id):
    """Cria categorias padrão para um tenant novo."""
    defaults = ["Alimentação", "Transporte", "Moradia", "Lazer", "Saúde", "Outros"]
    conn = get_connection()
    cursor = conn.cursor()
    for name in defaults:
        cursor.execute(
            "INSERT OR IGNORE INTO categories (tenant_id, name) VALUES (?, ?)",
            (tenant_id, name),
        )
    conn.commit()
    conn.close()
