"""
Teste do mp_oauth_account_sync.py com dados simulados (sem API real).
Cobre: sync de pagamentos via OAuth, consulta de cobranças/saldo/movimentações,
projeção opcional em despesas e idempotência.
"""

import argparse
import json

import mp_oauth_account_sync

TEST_DB_PATH = "TEST_db_oauth_sync.json"
TEST_CONFIG_PATH = "TEST_mp_oauth_account_config.json"

fixture_db = {
    "tenants": [{"id": "t1", "name": "Empresa Teste"}],
    "users": [{"id": "u1", "tenant_id": "t1", "email": "dona@example.com", "name": "Dona da Conta"}],
    "categories": [],
    "expenses": [],
    "payments": [],
    "budgets": [],
    "budgetLayouts": [],
    "categoryBudgets": [],
    "_seq": {},
}

cfg = {
    "conta_email": "DONA@EXAMPLE.COM",
    "mercado_pago_oauth_client_id": "cid",
    "mercado_pago_oauth_client_secret": "csecret",
    "mercado_pago_oauth_refresh_token": "refresh-old",
    "consultar_cobrancas": True,
    "consultar_saldo": True,
    "consultar_movimentacoes": True,
    "projetar_transacoes_em_despesas": True,
    "categoria_padrao": "Mercado Pago (OAuth)",
    "mapeamento": [{"palavra_chave": "uber", "categoria": "Transporte"}],
    "ignorar_descricoes_contendo": ["estorno"],
    "db_json": TEST_DB_PATH,
}


class FakeOAuthClient:
    def __init__(self, _cfg):
        pass

    def refresh_access_token(self, refresh_token):
        assert refresh_token == "refresh-old"
        return {
            "access_token": "access-new",
            "refresh_token": "refresh-new",
            "scope": "payments read write",
            "expires_in": 3600,
            "user_id": 123,
            "token_type": "Bearer",
        }

    def exchange_authorization_code(self, _code, _redirect_uri):
        raise AssertionError("não deveria usar authorization_code neste teste")

    def fetch_payments(self, _access_token, _begin, _end):
        return [
            {
                "id": "pay-1",
                "transaction_amount": 35.9,
                "status": "approved",
                "description": "UBER TRIP",
                "date_approved": "2026-08-08T10:00:00.000-03:00",
                "type": "debit",
            },
            {
                "id": "pay-2",
                "transaction_amount": 19.5,
                "status": "approved",
                "description": "UBER cashback recebido",
                "date_approved": "2026-08-08T11:00:00.000-03:00",
                "type": "recebimento_beneficio",
            },
        ]

    def fetch_charges(self, _access_token, _begin, _end):
        return [{"id": "ch-1", "status": "paid", "amount": 100.0}]

    def fetch_balance(self, _access_token):
        return {"id": 999, "available_balance": 500.0, "currency_id": "BRL"}

    def fetch_movements(self, _access_token, _begin, _end):
        return [
            {
                "id": "mv-1",
                "amount": 12.4,
                "status": "posted",
                "direction": "debit",
                "description": "ifood pedido",
                "date": "2026-08-09T09:00:00.000-03:00",
            }
        ]


with open(TEST_DB_PATH, "w", encoding="utf-8") as f:
    json.dump(fixture_db, f, ensure_ascii=False)

with open(TEST_CONFIG_PATH, "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False)

Args = argparse.Namespace(
    config=TEST_CONFIG_PATH,
    dias=30,
    authorization_code=None,
    refresh_token=None,
    access_token=None,
    firebase_service_account=None,
    db_json=None,
    dry_run=False,
)

agent = mp_oauth_account_sync.MercadoPagoOAuthAccountAgent()
agent.oauth_client_cls = FakeOAuthClient
result, msg = agent.run(Args)
assert result == "ok", (result, msg)

with open(TEST_DB_PATH, encoding="utf-8") as f:
    db_after = json.load(f)

assert len(db_after.get("payments", [])) == 2
assert len(db_after.get("expenses", [])) == 3  # 2 pagamentos + 1 movimentação
orcamento = next(e for e in db_after["expenses"] if e["description"] == "UBER cashback recebido")
cat_orcamento = next(c for c in db_after["categories"] if c["id"] == orcamento["category_id"])
assert cat_orcamento["name"] == "Orçamento", cat_orcamento
assert orcamento.get("mercadoPagoTransactionDirection") == "credit", orcamento
assert db_after["mercado_pago_oauth_data"]["t1"]["payments_count"] == 2
assert db_after["mercado_pago_oauth_data"]["t1"]["charges_count"] == 1
assert db_after["mercado_pago_oauth_data"]["t1"]["movements_count"] == 1

status = db_after.get("mercado_pago_status", {}).get("t1", {}).get("last_oauth_account_sync", {})
assert status.get("payments_synced_created") == 2
assert status.get("expenses_created") == 3
print("OK run() sincroniza pagamentos/cobranças/saldo/movimentações e gera despesas")

# Roda de novo para validar idempotência de despesas/pagamentos
result2, msg2 = agent.run(Args)
assert result2 == "ok", (result2, msg2)
with open(TEST_DB_PATH, encoding="utf-8") as f:
    db_after_2 = json.load(f)
assert len(db_after_2.get("payments", [])) == 2
assert len(db_after_2.get("expenses", [])) == 3
print("OK idempotência: reprocessar snapshot não duplica pagamentos nem despesas")

print("\nTODOS OS TESTES PASSARAM ✅")
