"""
Teste do mp_open_finance_sync.py com dados simulados.
Cobre: remoção de CVV, mascaramento de PAN, idempotência e run() em modo webhook.
"""

import argparse
import json

import mp_open_finance_sync

TEST_DB_PATH = "TEST_db_open_finance.json"
TEST_CONFIG_PATH = "TEST_mp_open_finance_config.json"
TEST_PAYLOAD_PATH = "TEST_open_finance_payload.json"

fixture_db = {
    "tenants": [{"id": "t1", "name": "Empresa Teste"}],
    "users": [{"id": "u1", "tenant_id": "t1", "email": "dona@example.com", "name": "Dona da Conta"}],
    "categories": [{"id": "c-transporte", "tenant_id": "t1", "name": "Transporte"}],
    "expenses": [],
    "payments": [],
    "budgets": [],
    "budgetLayouts": [],
    "categoryBudgets": [],
    "_seq": {},
}

snapshot_with_sensitive = {
    "cards": [
        {
            "id": "card-1",
            "brand": "master",
            "number": "5299230012345678",
            "cvv": "123",
            "holder_name": "Fulano",
            "credit_limit": 5000,
            "available_limit": 4100,
            "status": "active",
        }
    ],
    "transactions": [
        {
            "id": "tx-1",
            "card_id": "card-1",
            "amount": 35.9,
            "direction": "debit",
            "status": "posted",
            "description": "UBER TRIP 001",
            "merchant_name": "Uber",
            "posted_at": "2026-08-08T10:00:00.000-03:00",
            "installments": 1,
            "security_code": "999",
        },
        {
            "id": "tx-2",
            "card_id": "card-1",
            "amount": 15,
            "direction": "credit",
            "status": "posted",
            "description": "ESTORNO",
            "posted_at": "2026-08-08T12:00:00.000-03:00",
        },
    ],
}

cfg = {
    "provider": "open_finance_mp",
    "conta_email": "DONA@EXAMPLE.COM",
    "card_token_secret": "segredo-teste",
    "projetar_transacoes_em_despesas": True,
    "categoria_padrao": "Cartão Mercado Pago",
    "mapeamento": [{"palavra_chave": "uber", "categoria": "Transporte"}],
    "ignorar_descricoes_contendo": [],
}

cleaned, removed = mp_open_finance_sync.sanitize_payload(snapshot_with_sensitive)
assert "cvv" not in cleaned["cards"][0]
assert "security_code" not in cleaned["transactions"][0]
assert cleaned["cards"][0].get("last4") == "5678"
assert set(removed) == {"cvv", "security_code"}
print("OK sanitize_payload remove CVV/security_code e preserva apenas last4")

engine = mp_open_finance_sync.CardSyncEngine(cfg)
db = json.loads(json.dumps(fixture_db))
summary1 = engine.sync(db, snapshot_with_sensitive, "t1", "u1")
assert summary1["cards_created"] == 1, summary1
assert summary1["transactions_created"] == 2, summary1
assert summary1["expenses_created"] == 1, summary1
assert summary1["categories_created"] == 0, summary1
assert summary1["removed_sensitive_fields"] == ["cvv", "security_code"], summary1

card_row = db["openFinanceCards"][0]
assert card_row["last4"] == "5678"
assert "cvv" not in json.dumps(card_row).lower()
expense = db["expenses"][0]
assert expense["openFinanceTransactionId"] == "tx-1"
assert expense["mercadoPagoSource"] == "open_finance"
print("OK sync gera cartão/transações/despesa sem vazar CVV")

summary2 = engine.sync(db, snapshot_with_sensitive, "t1", "u1")
assert summary2["cards_created"] == 0 and summary2["cards_updated"] == 1, summary2
assert summary2["transactions_created"] == 0 and summary2["transactions_updated"] == 2, summary2
assert summary2["expenses_created"] == 0, summary2
assert len(db["expenses"]) == 1
print("OK idempotência: reprocessar snapshot não duplica despesas nem transações")

with open(TEST_DB_PATH, "w", encoding="utf-8") as f:
    json.dump(fixture_db, f, ensure_ascii=False)

with open(TEST_PAYLOAD_PATH, "w", encoding="utf-8") as f:
    json.dump(snapshot_with_sensitive, f, ensure_ascii=False)

with open(TEST_CONFIG_PATH, "w", encoding="utf-8") as f:
    json.dump({**cfg, "db_json": TEST_DB_PATH}, f)

Args = argparse.Namespace(
    config=TEST_CONFIG_PATH,
    dias=30,
    modo="webhook",
    payload=TEST_PAYLOAD_PATH,
    firebase_service_account=None,
    db_json=None,
    dry_run=False,
)

result, msg = mp_open_finance_sync.run(Args)
assert result == "ok", (result, msg)

with open(TEST_DB_PATH, encoding="utf-8") as f:
    db_after = json.load(f)

assert len(db_after.get("openFinanceCards", [])) == 1
assert len(db_after.get("openFinanceCardTransactions", [])) == 2
assert len(db_after.get("expenses", [])) == 1
status = db_after.get("mercado_pago_status", {}).get("t1", {}).get("last_open_finance_sync", {})
assert status.get("cards_created") == 1
assert status.get("transactions_created") == 2
assert status.get("expenses_created") == 1
print("OK run() webhook grava dados no db_json e atualiza status de sincronização")

# roda de novo e permanece idempotente
result2, _ = mp_open_finance_sync.run(Args)
assert result2 == "ok"
with open(TEST_DB_PATH, encoding="utf-8") as f:
    db_after_2 = json.load(f)
assert len(db_after_2.get("expenses", [])) == 1
print("OK run() repetido não duplica despesas projetadas")

print("\nTODOS OS TESTES PASSARAM ✅")
