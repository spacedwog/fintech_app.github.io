"""
Teste ponta-a-ponta do mp_sync.py sem chamar a API real do Mercado Pago.
Cobre: categorização, gravação em MP_Transacoes, recálculo, detecção de
estouro, e o caso de sincronizar um mês que ainda não existe no orçamento.
"""
import shutil
import openpyxl
import mp_sync

PLANILHA = "Orcamento_Casamento_do_Ano.xlsx"
TEST_PLANILHA = "TEST_Orcamento.xlsx"
shutil.copy(PLANILHA, TEST_PLANILHA)

# Pagamentos simulados de Janeiro/2025: Gympass estourando o previsto de R$1.500
fake_payments = [
    {"id": 111, "description": "GYMPASS ASSINATURA MENSAL", "transaction_amount": 1500.00,
     "status": "approved", "date_approved": "2025-01-05T10:00:00.000-03:00"},
    {"id": 112, "description": "GYMPASS TAXA EXTRA", "transaction_amount": 400.00,
     "status": "approved", "date_approved": "2025-01-20T10:00:00.000-03:00"},
    {"id": 113, "description": "PIX FAXINEIRA MARIA", "transaction_amount": 1600.00,
     "status": "approved", "date_approved": "2025-01-10T10:00:00.000-03:00"},
    {"id": 114, "description": "PAGAMENTO NAO MAPEADO XYZ", "transaction_amount": 50.00,
     "status": "approved", "date_approved": "2025-01-15T10:00:00.000-03:00"},
    {"id": 115, "description": "GYMPASS PENDENTE", "transaction_amount": 999.00,
     "status": "rejected", "date_approved": "2025-01-16T10:00:00.000-03:00"},
]

wb = openpyxl.load_workbook(TEST_PLANILHA)
rules = mp_sync.load_mapping_rules(wb)

# categorização
cat1 = mp_sync.categorize("GYMPASS ASSINATURA MENSAL", rules)
cat2 = mp_sync.categorize("PIX FAXINEIRA MARIA", rules)
cat3 = mp_sync.categorize("PAGAMENTO NAO MAPEADO XYZ", rules)
assert cat1 == "Saúde", f"esperado Saúde, veio {cat1}"
assert cat2 == "Moradia", f"esperado Moradia, veio {cat2}"
assert cat3 == "Não categorizado", f"esperado Não categorizado, veio {cat3}"
print("OK categorização:", cat1, "|", cat2, "|", cat3)

# mes_label
assert mp_sync.mes_label("2025-01") == "Janeiro - 2025"
assert mp_sync.mes_label("2026-08") == "Agosto - 2026"
print("OK mes_label")

gravados = mp_sync.write_transactions(wb, fake_payments, rules, "2025-01", somente_aprovados=True)
wb.save(TEST_PLANILHA)
assert gravados == 4, gravados
print(f"OK gravados: {gravados}")

mp_sync.recalc(TEST_PLANILHA)

mes_existe, alerts = mp_sync.check_alerts(TEST_PLANILHA, "Janeiro - 2025")
assert mes_existe is True
categorias_estouradas = {a[0] for a in alerts}
assert "Saúde" in categorias_estouradas, alerts
assert "Moradia" not in categorias_estouradas, alerts
print("OK alertas Janeiro-2025:", alerts)

# mês que NÃO existe na planilha (ex: mês atual real, fora do orçamento de teste)
mes_existe_fora, alerts_fora = mp_sync.check_alerts(TEST_PLANILHA, "Agosto - 2026")
assert mes_existe_fora is False, "Agosto-2026 não deveria existir nesse orçamento de teste"
assert alerts_fora == []
print("OK detecção de mês fora do orçamento (não finge que está tudo certo)")

# valores exatos na aba Resumo_MP
wb2 = openpyxl.load_workbook(TEST_PLANILHA, data_only=True)
ws2 = wb2["Resumo_MP"]
found = {}
for row in ws2.iter_rows(min_row=3, values_only=True):
    categoria, mes, previsto, gasto, saldo, status = (row + (None,) * 6)[:6]
    if mes == "Janeiro - 2025":
        found[categoria] = (previsto, gasto, saldo, status)

assert found["Saúde"][1] == 1900.00, found["Saúde"]
assert found["Saúde"][3] == "ESTOURADO"
assert found["Moradia"][1] == 1600.00
assert found["Moradia"][3] == "DENTRO DO ORÇAMENTO"
print("OK valores Resumo_MP:", found["Saúde"], "|", found["Moradia"])

# MP_Transacoes sem o pagamento rejeitado
ws3 = openpyxl.load_workbook(TEST_PLANILHA)["MP_Transacoes"]
descs = [r[2] for r in ws3.iter_rows(min_row=2, values_only=True) if r[0]]
assert len(descs) == 4
assert "GYMPASS PENDENTE" not in descs
print("OK MP_Transacoes:", descs)

# roda run() completo com um config.json falso apontando para a planilha de teste
import json
with open("TEST_config.json", "w", encoding="utf-8") as f:
    json.dump({"mercado_pago_access_token": "TEST-fake", "planilha": TEST_PLANILHA}, f)

import argparse
Args = argparse.Namespace(mes="2025-01", config="TEST_config.json", somente_aprovados=True)

# monkeypatch fetch_mp_payments pra não bater na API real
mp_sync.fetch_mp_payments = lambda token, begin, end: fake_payments
resultado, msg = mp_sync.run(Args)
assert resultado == "estourado", (resultado, msg)
print("OK run() end-to-end:", resultado)

print("\nTODOS OS TESTES PASSARAM ✅")
