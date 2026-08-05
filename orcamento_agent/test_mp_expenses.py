"""
Teste ponta-a-ponta do mp_expenses.py sem chamar a API real do Mercado Pago.
Cobre: categorização por palavra-chave, criação de categoria padrão quando
nada bate, exclusão de pagamentos já reconciliados como receita (payments),
exclusão por filtro de descrição, idempotência (rodar duas vezes não
duplica) e run() end-to-end com fonte db.json local.
"""
import argparse
import json
import os

import mp_expenses

TEST_DB_PATH = "TEST_db_expenses.json"
TEST_CONFIG_PATH = "TEST_mp_expenses_config.json"

fixture_db = {
    "tenants": [{"id": "t1", "name": "Empresa Teste"}],
    "users": [{"id": "u1", "tenant_id": "t1", "email": "dona@example.com", "name": "Dona da Conta"}],
    "categories": [{"id": "c1", "tenant_id": "t1", "name": "Transporte"}],
    "expenses": [],
    "payments": [
        # cobrança de assinatura já reconciliada com o Mercado Pago -- é
        # receita da conta, NUNCA deve virar despesa.
        {"id": "pay1", "tenant_id": "t1", "type": "plano", "amount": 19.99, "verifiedByMercadoPago": True, "mercadoPagoPaymentId": 5001},
    ],
    "budgets": [],
    "budgetLayouts": [],
    "categoryBudgets": [],
    "_seq": {},
}

fake_mp_payments = [
    # já é a assinatura reconciliada acima -> deve ser ignorado (ignoradas_receita)
    {"id": 5001, "status": "approved", "transaction_amount": 19.99, "description": "Assinatura Premium — Fintech Spacecworp", "date_approved": "2026-08-02T09:00:00.000-03:00"},
    # bate com a regra de mapeamento "uber" -> categoria Transporte (já existe, não deve duplicar)
    {"id": 5002, "status": "approved", "transaction_amount": 35.50, "description": "UBER *TRIP 123", "date_approved": "2026-08-03T08:00:00.000-03:00"},
    # não bate com nenhuma regra -> categoria padrão (nova)
    {"id": 5003, "status": "approved", "transaction_amount": 89.90, "description": "LOJA QUALQUER XYZ", "date_approved": "2026-08-04T12:00:00.000-03:00"},
    # descrição bate com o filtro de reforço "despesa extra" -> ignorado mesmo sem estar em payments
    {"id": 5004, "status": "approved", "transaction_amount": 5.0, "description": "Despesa extra — limite diário do plano Free", "date_approved": "2026-08-05T10:00:00.000-03:00"},
    # não aprovado -> ignorado
    {"id": 5005, "status": "rejected", "transaction_amount": 100.0, "description": "PAGAMENTO REJEITADO", "date_approved": "2026-08-06T10:00:00.000-03:00"},
]

cfg = {
    "mercado_pago_access_token": "TEST-fake",
    "conta_email": "DONA@EXAMPLE.COM",  # maiúsculo de propósito, pra testar comparação case-insensitive
    "mapeamento": [{"palavra_chave": "uber", "categoria": "Transporte"}],
    "categoria_padrao": "Mercado Pago (não categorizado)",
}

# ---------- generate_expenses() isolado ----------

db1 = json.loads(json.dumps(fixture_db))  # cópia profunda
resultado1 = mp_expenses.generate_expenses(db1, fake_mp_payments, "t1", "u1", cfg)

assert len(resultado1["criadas"]) == 2, resultado1["criadas"]
assert resultado1["ignoradas_receita"] == 1, resultado1
assert resultado1["ignoradas_filtro"] == 1, resultado1
assert resultado1["categorias_novas"] == 1, resultado1  # só "Mercado Pago (não categorizado)" é nova
print("OK generate_expenses: gerou 2 despesas, ignorou receita e filtro de descrição corretamente")

uber_expense = next(e for e in resultado1["criadas"] if e["mercadoPagoPaymentId"] == 5002)
categoria_uber = next(c for c in db1["categories"] if c["id"] == uber_expense["category_id"])
assert categoria_uber["name"] == "Transporte", categoria_uber
assert categoria_uber["id"] == "c1", "deveria reaproveitar a categoria Transporte já existente, não duplicar"
print("OK categorização por palavra-chave reaproveita categoria já existente (Transporte)")

loja_expense = next(e for e in resultado1["criadas"] if e["mercadoPagoPaymentId"] == 5003)
categoria_loja = next(c for c in db1["categories"] if c["id"] == loja_expense["category_id"])
assert categoria_loja["name"] == "Mercado Pago (não categorizado)", categoria_loja
print("OK pagamento sem regra de mapeamento cai na categoria padrão (criada automaticamente)")

assert uber_expense["is_extra"] is False and uber_expense["extra_charge"] == 0
assert uber_expense["generatedByMercadoPago"] is True
print("OK despesas geradas não cobram taxa de extra e ficam marcadas como geradas via Mercado Pago")

# ---------- idempotência: rodar de novo com o mesmo db1 não duplica ----------

resultado2 = mp_expenses.generate_expenses(db1, fake_mp_payments, "t1", "u1", cfg)
assert len(resultado2["criadas"]) == 0, resultado2["criadas"]
assert resultado2["ignoradas_duplicadas"] == 2, resultado2
print("OK idempotência: rodar generate_expenses de novo não duplica despesas já importadas")

# ---------- run() end-to-end (fonte db.json local, Mercado Pago monkeypatchado) ----------

with open(TEST_DB_PATH, "w", encoding="utf-8") as f:
    json.dump(fixture_db, f, ensure_ascii=False)
with open(TEST_CONFIG_PATH, "w", encoding="utf-8") as f:
    json.dump({**cfg, "db_json": TEST_DB_PATH}, f)

mp_expenses.mp_sync.fetch_mp_payments = lambda token, begin, end: fake_mp_payments

Args = argparse.Namespace(
    config=TEST_CONFIG_PATH, dias=30, firebase_service_account=None, db_json=None, dry_run=False,
)
resultado, msg = mp_expenses.run(Args)
assert resultado == "ok", (resultado, msg)

with open(TEST_DB_PATH, encoding="utf-8") as f:
    depois = json.load(f)
novas_despesas = [e for e in depois["expenses"] if e.get("generatedByMercadoPago")]
assert len(novas_despesas) == 2, novas_despesas
print("OK run() end-to-end (fonte db.json local): despesas gravadas de verdade no arquivo")

# rodar de novo (run completo) não duplica
resultado_dup, _ = mp_expenses.run(Args)
assert resultado_dup == "sem_novidades", resultado_dup
with open(TEST_DB_PATH, encoding="utf-8") as f:
    depois2 = json.load(f)
assert len([e for e in depois2["expenses"] if e.get("generatedByMercadoPago")]) == 2
print("OK run() end-to-end rodado de novo não duplica despesas (idempotente de ponta a ponta)")

# e-mail de conta inexistente -> erro claro
with open(TEST_CONFIG_PATH, "w", encoding="utf-8") as f:
    json.dump({**cfg, "db_json": TEST_DB_PATH, "conta_email": "ninguem@example.com"}, f)
resultado_erro, msg_erro = mp_expenses.run(Args)
assert resultado_erro == "erro" and "ninguem@example.com" in msg_erro, (resultado_erro, msg_erro)
print("OK erro claro quando conta_email não corresponde a nenhum usuário")

# --dry-run não grava nada
with open(TEST_DB_PATH, "w", encoding="utf-8") as f:
    json.dump(fixture_db, f, ensure_ascii=False)
with open(TEST_CONFIG_PATH, "w", encoding="utf-8") as f:
    json.dump({**cfg, "db_json": TEST_DB_PATH}, f)
with open(TEST_DB_PATH, encoding="utf-8") as f:
    antes = json.load(f)

Args_dry = argparse.Namespace(
    config=TEST_CONFIG_PATH, dias=30, firebase_service_account=None, db_json=None, dry_run=True,
)
resultado_dry, _ = mp_expenses.run(Args_dry)
assert resultado_dry == "ok"
with open(TEST_DB_PATH, encoding="utf-8") as f:
    depois_dry = json.load(f)
assert antes == depois_dry, "--dry-run não deveria gravar nada"
print("OK --dry-run não grava nada")

print("\nTODOS OS TESTES PASSARAM ✅")
