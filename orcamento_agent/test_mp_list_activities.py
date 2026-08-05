"""
Teste do mp_list_activities.py sem chamar a API real do Mercado Pago.
Cobre: formatação de linha/resumo por status, exportação CSV/JSON,
filtro por --status, find_default_config() (reaproveita o config.json real
desta pasta, mas só verifica QUAL arquivo seria escolhido -- nunca chama a
API de verdade), erro claro sem config e com token placeholder, e
list_activities() end-to-end com fetch_mp_payments monkeypatchado.
"""
import argparse
import csv
import json
import os

import mp_list_activities as mpl

fake_payments = [
    {"id": 1, "status": "approved", "transaction_amount": 35.50, "description": "UBER *TRIP", "date_created": "2026-08-05T10:00:00.000-03:00", "date_approved": "2026-08-05T10:00:05.000-03:00", "payment_method_id": "pix", "payer": {"email": "quemgastou@example.com"}},
    {"id": 2, "status": "approved", "transaction_amount": 89.90, "description": "LOJA XYZ", "date_created": "2026-08-04T09:00:00.000-03:00", "date_approved": "2026-08-04T09:00:05.000-03:00", "payment_method_id": "credit_card", "payer": {}},
    {"id": 3, "status": "rejected", "transaction_amount": 100.0, "description": "PAGAMENTO REJEITADO", "date_created": "2026-08-03T08:00:00.000-03:00", "date_approved": None, "payment_method_id": "credit_card", "payer": {}},
    {"id": 4, "status": "pending", "transaction_amount": 19.99, "description": "ASSINATURA", "date_created": "2026-08-02T07:00:00.000-03:00", "date_approved": None, "payment_method_id": "pix", "payer": {}},
]

# ---------- ActivityFormatter ----------

resumo = mpl.ActivityFormatter.resumo(fake_payments)
assert "4 atividade(s) encontrada(s)" in resumo
assert "R$ 125.40" in resumo  # 35.50 + 89.90 (só os approved)
print("OK ActivityFormatter.resumo: conta total e soma só os pagamentos aprovados")

linha = mpl.ActivityFormatter.linha(fake_payments[0])
assert "2026-08-05" in linha and "35.50" in linha and "approved" in linha and "#1" in linha
print("OK ActivityFormatter.linha: formata data, valor, status e id")

linha_sem_payer = mpl.ActivityFormatter.linha(fake_payments[1])
assert "-" in linha_sem_payer  # payer.email ausente cai no placeholder "-"
print("OK ActivityFormatter.linha: pagamento sem e-mail do pagador não quebra (usa placeholder)")

# ---------- ActivityExporter ----------

TEST_CSV = "TEST_mp_activities.csv"
TEST_JSON = "TEST_mp_activities.json"

mpl.ActivityExporter.export(fake_payments, TEST_CSV)
with open(TEST_CSV, encoding="utf-8") as f:
    linhas_csv = list(csv.DictReader(f))
assert len(linhas_csv) == 4
assert linhas_csv[0]["payer_email"] == "quemgastou@example.com"
print("OK ActivityExporter.export (CSV): grava todas as linhas com o e-mail do pagador")

mpl.ActivityExporter.export(fake_payments, TEST_JSON)
with open(TEST_JSON, encoding="utf-8") as f:
    dados_json = json.load(f)
assert len(dados_json) == 4 and dados_json[0]["id"] == 1
print("OK ActivityExporter.export (JSON): grava a lista completa (pela extensão .json)")

# ---------- find_default_config() ----------

# Roda a partir de orcamento_agent/ (mesma convenção dos outros testes desta
# pasta) -- config.json já existe aqui de verdade, então é o 1º candidato.
assert mpl.find_default_config() == "config.json"
print("OK find_default_config(): escolhe config.json quando ele existe (não chama a API, só checa o arquivo)")

# ---------- list_activities() end-to-end (fetch_mp_payments monkeypatchado) ----------

TEST_CONFIG_PATH = "TEST_mp_list_activities_config.json"
with open(TEST_CONFIG_PATH, "w", encoding="utf-8") as f:
    json.dump({"mercado_pago_access_token": "TEST-fake-token"}, f)

mpl.mp_sync.fetch_mp_payments = lambda token, begin, end: fake_payments

Args = argparse.Namespace(config=TEST_CONFIG_PATH, dias=30, status=None, limit=50, export=None)
resultado, msg = mpl.list_activities(Args)
assert resultado == "ok"
assert "4 atividade(s) encontrada(s)" in msg
print("OK list_activities() end-to-end: lê o config de teste e devolve o resumo certo (sem chamar a API real)")

# filtro por status
Args_status = argparse.Namespace(config=TEST_CONFIG_PATH, dias=30, status="approved", limit=50, export=None)
resultado_status, msg_status = mpl.list_activities(Args_status)
assert resultado_status == "ok"
assert "2 atividade(s) encontrada(s)" in msg_status  # só os 2 approved
print("OK list_activities() --status filtra antes de formatar/exportar")

# export via list_activities()
Args_export = argparse.Namespace(config=TEST_CONFIG_PATH, dias=30, status=None, limit=50, export=TEST_JSON)
mpl.list_activities(Args_export)
with open(TEST_JSON, encoding="utf-8") as f:
    exportado = json.load(f)
assert len(exportado) == 4
print("OK list_activities() --export salva o arquivo de verdade")

# ---------- erros claros ----------

Args_sem_config = argparse.Namespace(config="TEST_nao_existe.json", dias=30, status=None, limit=50, export=None)
resultado_erro, msg_erro = mpl.list_activities(Args_sem_config)
assert resultado_erro == "erro" and "TEST_nao_existe.json" in msg_erro
print("OK erro claro quando o config não existe")

TEST_CONFIG_PLACEHOLDER = "TEST_mp_list_activities_config_placeholder.json"
with open(TEST_CONFIG_PLACEHOLDER, "w", encoding="utf-8") as f:
    json.dump({"mercado_pago_access_token": "COLE_SEU_ACCESS_TOKEN_AQUI"}, f)
Args_placeholder = argparse.Namespace(config=TEST_CONFIG_PLACEHOLDER, dias=30, status=None, limit=50, export=None)
resultado_placeholder, msg_placeholder = mpl.list_activities(Args_placeholder)
assert resultado_placeholder == "erro" and "não configurado" in msg_placeholder
print("OK erro claro quando o token ainda é o placeholder do exemplo")

for path in (TEST_CSV, TEST_JSON, TEST_CONFIG_PATH, TEST_CONFIG_PLACEHOLDER):
    if os.path.exists(path):
        os.remove(path)

print("\nTODOS OS TESTES PASSARAM ✅")
