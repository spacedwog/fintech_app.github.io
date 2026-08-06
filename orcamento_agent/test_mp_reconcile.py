"""
Teste ponta-a-ponta do mp_reconcile.py sem chamar a API real do Mercado Pago
nem o Firestore real. Cobre: verificação automática por valor+data, ambiguidade
(duas correspondências possíveis pro mesmo valor/janela), pagamento sem
correspondência, pagamento que já estava verificado (por IA) sendo ignorado,
a fonte LocalJsonSource (leitura/gravação preservando o resto do banco),
run() end-to-end e --dry-run não gravando nada.
"""
import argparse
import json
import os

import mp_reconcile

TEST_DB_PATH = "TEST_db_reconcile.json"
TEST_CONFIG_PATH = "TEST_mp_reconcile_config.json"

# Pagamentos já gravados pelo app (js/api.js -> addPayment), pendentes de
# verificação (verifiedByAI=False), exceto o #5 que já foi validado por IA.
app_payments = [
    {"id": "1", "tenant_id": "t1", "type": "despesa_extra", "amount": 5.0,
     "txid": "DESPABC", "verifiedByAI": False, "date": "2026-08-01T12:00:00.000Z"},
    {"id": "2", "tenant_id": "t1", "type": "plano", "plan": "premium", "amount": 19.99,
     "txid": "PLANOXYZ", "verifiedByAI": False, "date": "2026-08-02T09:00:00.000Z"},
    {"id": "3", "tenant_id": "t1", "type": "despesa_extra", "amount": 5.0,
     "txid": "DESPQWE", "verifiedByAI": False, "date": "2026-08-03T15:00:00.000Z"},
    {"id": "4", "tenant_id": "t1", "type": "despesa_extra", "amount": 42.0,
     "txid": "DESPNADA", "verifiedByAI": False, "date": "2026-08-04T10:00:00.000Z"},
    {"id": "5", "tenant_id": "t1", "type": "despesa_extra", "amount": 5.0,
     "txid": "DESPJATEM", "verifiedByAI": True, "date": "2026-08-05T08:00:00.000Z"},
]

fake_mp_payments = [
    {"id": 9001, "status": "approved", "transaction_amount": 19.99, "date_approved": "2026-08-02T09:05:00.000-03:00"},
    {"id": 9002, "status": "approved", "transaction_amount": 5.0, "date_approved": "2026-08-01T12:10:00.000-03:00"},  # bate único com #1
    {"id": 9003, "status": "approved", "transaction_amount": 5.0, "date_approved": "2026-08-03T15:20:00.000-03:00"},  # ambíguo com #3
    {"id": 9004, "status": "approved", "transaction_amount": 5.0, "date_approved": "2026-08-03T16:00:00.000-03:00"},  # ambíguo com #3
    {"id": 9005, "status": "rejected", "transaction_amount": 42.0, "date_approved": "2026-08-04T10:00:00.000-03:00"},  # rejeitado, não conta pro #4
]

# ---------- reconcile_payments() isolado ----------

updated, resumo = mp_reconcile.reconcile_payments(app_payments, fake_mp_payments, window_days=1)
by_id = {p["id"]: p for p in updated}

assert by_id["1"].get("verifiedByMercadoPago") is True and by_id["1"].get("mercadoPagoPaymentId") == 9002, by_id["1"]
assert by_id["2"].get("verifiedByMercadoPago") is True and by_id["2"].get("mercadoPagoPaymentId") == 9001, by_id["2"]
assert not by_id["3"].get("verifiedByMercadoPago"), "pagamento ambíguo não deveria ser confirmado automaticamente"
assert not by_id["4"].get("verifiedByMercadoPago"), "pagamento sem correspondência aprovada não deveria ser confirmado"
assert by_id["5"].get("verifiedByAI") is True and not by_id["5"].get("mercadoPagoPaymentId"), "já verificado por IA, deveria ser ignorado"

assert len(resumo["verificados"]) == 2, resumo["verificados"]
assert len(resumo["ambiguos"]) == 1 and resumo["ambiguos"][0]["payment_id"] == "3", resumo["ambiguos"]
assert len(resumo["sem_correspondencia"]) == 1 and resumo["sem_correspondencia"][0]["payment_id"] == "4", resumo["sem_correspondencia"]
assert resumo["ja_verificados"] == 1, resumo
print("OK reconcile_payments: verificados, ambíguos, sem correspondência e já verificados tratados corretamente")

# não muta a lista original
assert app_payments[0].get("verifiedByMercadoPago") is None, "reconcile_payments não deveria mutar a lista original"
print("OK reconcile_payments não muta a lista original")

# ---------- to_utc_date ----------

assert mp_reconcile.to_utc_date("2026-08-01T12:00:00.000Z") is not None
assert mp_reconcile.to_utc_date("2026-08-01T12:00:00.000-03:00") is not None
assert mp_reconcile.to_utc_date(None) is None
assert mp_reconcile.to_utc_date("lixo") is None
print("OK to_utc_date: aceita 'Z' e offset numérico, devolve None para entradas inválidas")

# ---------- LocalJsonSource: preserva o resto do banco ----------

fixture_db = {
    "tenants": [{"id": "t1", "name": "Teste"}], "users": [], "categories": [], "expenses": [],
    "budgets": [], "payments": app_payments,
    "_seq": {"tenants": 1, "users": 0, "categories": 0, "expenses": 0, "budgets": 0, "payments": 5},
}
with open(TEST_DB_PATH, "w", encoding="utf-8") as f:
    json.dump(fixture_db, f, ensure_ascii=False)

source = mp_reconcile.LocalJsonSource(TEST_DB_PATH)
read_back = source.read()
assert read_back["payments"][0]["id"] == "1"

source.write_payments(updated)
with open(TEST_DB_PATH, encoding="utf-8") as f:
    saved = json.load(f)
assert saved["payments"][0]["verifiedByMercadoPago"] is True
assert saved["tenants"] == [{"id": "t1", "name": "Teste"}], "write_payments não deveria tocar em outros campos do banco"
print("OK LocalJsonSource: lê e grava só a lista de pagamentos, preservando o resto do banco")

# ---------- run() end-to-end (fonte db.json local, Mercado Pago monkeypatchado) ----------

with open(TEST_DB_PATH, "w", encoding="utf-8") as f:
    json.dump(fixture_db, f, ensure_ascii=False)  # reseta pro estado "não verificado ainda"

with open(TEST_CONFIG_PATH, "w", encoding="utf-8") as f:
    json.dump({"mercado_pago_access_token": "TEST-fake", "db_json": TEST_DB_PATH}, f)

mp_reconcile.mp_sync.fetch_mp_payments = lambda token, begin, end: fake_mp_payments

Args = argparse.Namespace(
    config=TEST_CONFIG_PATH, dias=30, janela_correspondencia=1,
    firebase_service_account=None, db_json=None, dry_run=False,
)
resultado, msg = mp_reconcile.run(Args)
assert resultado == "ok", (resultado, msg)
with open(TEST_DB_PATH, encoding="utf-8") as f:
    depois_do_run = json.load(f)
assert depois_do_run["payments"][0]["verifiedByMercadoPago"] is True
print("OK run() end-to-end (fonte db.json local):", resultado)

# ---------- StatusTracker: status de sincronização gravado após run() ----------
status_global = depois_do_run.get("mercado_pago_status", {}).get("global", {})
assert "last_reconcile" in status_global, depois_do_run.get("mercado_pago_status")
assert status_global["last_reconcile"]["verificados"] == 2, status_global
assert "at" in status_global["last_reconcile"]
print("OK StatusTracker: run() grava mercado_pago_status.global.last_reconcile (contagem + horário) para o painel web ler")

# config inexistente -> erro claro, sem traceback cru
Args_sem_config = argparse.Namespace(
    config="TEST_config_que_nao_existe.json", dias=30, janela_correspondencia=1,
    firebase_service_account=None, db_json=None, dry_run=False,
)
resultado_erro, msg_erro = mp_reconcile.run(Args_sem_config)
assert resultado_erro == "erro" and "não encontrado" in msg_erro.lower(), (resultado_erro, msg_erro)
print("OK erro claro quando o config não existe")

# --dry-run não grava nada
with open(TEST_DB_PATH, "w", encoding="utf-8") as f:
    json.dump(fixture_db, f, ensure_ascii=False)  # reseta de novo
with open(TEST_DB_PATH, encoding="utf-8") as f:
    antes = json.load(f)

Args_dry = argparse.Namespace(
    config=TEST_CONFIG_PATH, dias=30, janela_correspondencia=1,
    firebase_service_account=None, db_json=None, dry_run=True,
)
resultado_dry, _ = mp_reconcile.run(Args_dry)
assert resultado_dry == "ok"
with open(TEST_DB_PATH, encoding="utf-8") as f:
    depois = json.load(f)
assert antes == depois, "--dry-run não deveria gravar nada no banco"
print("OK --dry-run não grava nada")

# Não removemos os arquivos TEST_* ao final (mesma convenção de test_mp_sync.py):
# ficam no diretório para inspeção manual se algo der errado e já estão cobertos
# pelo .gitignore ("orcamento_agent/TEST_*.json").

print("\nTODOS OS TESTES PASSARAM ✅")
