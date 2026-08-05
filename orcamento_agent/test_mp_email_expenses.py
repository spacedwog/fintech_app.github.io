"""
Teste ponta-a-ponta do mp_email_expenses.py sem conectar em nenhuma caixa de
entrada real (nenhum IMAP, nenhuma API do Mercado Pago). Cobre:
  - EmailValueParser: extrai valor "R$ 1.234,56" do assunto/corpo, inclusive
    preferindo uma linha que contenha "valor" quando há mais de um "R$ ..."
    no corpo.
  - EmailClassifier: classifica assunto/corpo como despesa / receita /
    ignorar (cancelado, estornado, etc.) / desconhecido.
  - EmailPaymentParser: converte um email.message.EmailMessage (texto puro
    ou HTML) no MESMO formato que mp_sync.fetch_mp_payments() devolveria da
    API -- inclusive o caso "despesa sem valor reconhecível" e o fallback de
    id determinístico quando falta o Message-ID.
  - run() end-to-end com fetch_mp_emails() monkeypatchado e fonte db.json
    local: gera despesas de verdade, marca mercadoPagoSource="email", nunca
    duplica ao rodar de novo, ignora e-mail de receita da conta, erro claro
    quando conta_email não existe, e --dry-run não grava nada.
"""
import argparse
import json
from email.message import EmailMessage

import mp_email_expenses as mpe

# ---------- EmailValueParser ----------

assert mpe.EmailValueParser.parse_valor("Você pagou R$ 35,50 para UBER") == 35.50
assert mpe.EmailValueParser.parse_valor("Total: R$ 1.234,56") == 1234.56
assert mpe.EmailValueParser.parse_valor("sem nenhum valor aqui") is None
print("OK EmailValueParser.parse_valor: extrai valor em R$, com e sem milhar, e None quando não há valor")

corpo_com_dois_valores = "Saldo em conta: R$ 999,00\nValor do pagamento: R$ 42,10\nObrigado por usar o Mercado Pago."
assert mpe.EmailValueParser.parse_valor_preferindo_linha_com(corpo_com_dois_valores, "valor") == 42.10
print("OK EmailValueParser.parse_valor_preferindo_linha_com: prefere a linha com 'valor' em vez do primeiro R$ do texto")

# ---------- EmailClassifier ----------

clf = mpe.EmailClassifier()
assert clf.classify("Pagamento aprovado", "Você fez um pagamento de R$ 35,50 para UBER") == "despesa"
assert clf.classify("Você recebeu um Pix", "Você recebeu um pagamento de R$ 19,99") == "receita"
assert clf.classify("Pagamento cancelado", "Seu pagamento de R$ 10,00 foi cancelado") == "ignorar"
assert clf.classify("Assunto qualquer", "Corpo sem nenhuma palavra-chave conhecida") == "desconhecido"
print("OK EmailClassifier: despesa / receita / ignorar (cancelado) / desconhecido")

clf_custom = mpe.EmailClassifier(palavras_despesa=["comprovante de compra"])
assert clf_custom.classify("Comprovante de compra", "R$ 10,00") == "despesa"
assert clf_custom.classify("Pagamento aprovado", "R$ 10,00") == "desconhecido"  # não está na lista customizada
print("OK EmailClassifier aceita listas de palavras customizadas (sobrescreve o padrão, não soma)")

# ---------- EmailPaymentParser ----------


def make_email(subject, body, msg_id="<abc123@mail.example.com>", date="Wed, 05 Aug 2026 10:00:00 -0300", html=False):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = "Mercado Pago <notificacoes@mercadopago.com.br>"
    msg["To"] = "usuario@example.com"
    msg["Date"] = date
    if msg_id is not None:
        msg["Message-ID"] = msg_id
    msg.set_content(body, subtype="html" if html else "plain")
    return msg


parser = mpe.EmailPaymentParser(mpe.EmailClassifier())

payment, classe = parser.parse(make_email("Pagamento aprovado - UBER *TRIP 123", "Você fez um pagamento de R$ 35,50 para UBER *TRIP 123."))
assert classe == "despesa"
assert payment["transaction_amount"] == 35.50
assert payment["description"] == "Pagamento aprovado - UBER *TRIP 123"
assert payment["id"] == "<abc123@mail.example.com>"
assert payment["status"] == "approved"
assert payment["date_approved"] == "2026-08-05"
print("OK EmailPaymentParser.parse: e-mail de despesa (texto puro) vira um dict no formato mp_payments")

payment_html, classe_html = parser.parse(make_email(
    "Compra aprovada",
    "<html><body><p>Você fez uma <b>compra aprovada</b> de <strong>R$ 89,90</strong> em LOJA XYZ.</p></body></html>",
    msg_id="<html1@mail.example.com>",
    html=True,
))
assert classe_html == "despesa"
assert payment_html["transaction_amount"] == 89.90
print("OK EmailPaymentParser.parse: e-mail em HTML também funciona (tags removidas antes de procurar o valor)")

payment_receita, classe_receita = parser.parse(make_email("Você recebeu um pagamento", "Você recebeu um pagamento de R$ 19,99 via Pix."))
assert payment_receita is None and classe_receita == "receita"
print("OK EmailPaymentParser.parse: e-mail de receita da conta nunca vira despesa (payment=None)")

payment_cancelado, classe_cancelado = parser.parse(make_email("Pagamento cancelado", "Seu pagamento de R$ 10,00 foi cancelado."))
assert payment_cancelado is None and classe_cancelado == "ignorar"
print("OK EmailPaymentParser.parse: e-mail de cancelamento/estorno é ignorado")

payment_sem_valor, classe_sem_valor = parser.parse(make_email("Pagamento aprovado", "Seu pagamento foi aprovado com sucesso."))
assert payment_sem_valor is None and classe_sem_valor == "sem_valor"
print("OK EmailPaymentParser.parse: despesa sem valor 'R$ ...' reconhecível não vira payment (sem_valor)")

payment_sem_id, _ = parser.parse(make_email("Pagamento aprovado - Padaria", "Pagamento de R$ 12,00 aprovado.", msg_id=None))
assert payment_sem_id["id"].startswith("sememailid-")
payment_sem_id_2, _ = parser.parse(make_email("Pagamento aprovado - Padaria", "Pagamento de R$ 12,00 aprovado.", msg_id=None))
assert payment_sem_id["id"] == payment_sem_id_2["id"], "fallback de id sem Message-ID precisa ser determinístico (mesmo e-mail -> mesmo id)"
print("OK EmailPaymentParser.parse: e-mail sem Message-ID usa um id de fallback determinístico (não duplica ao reprocessar)")

# ---------- run() end-to-end (fetch_mp_emails monkeypatchado, fonte db.json local) ----------

TEST_DB_PATH = "TEST_db_email_expenses.json"
TEST_CONFIG_PATH = "TEST_mp_email_expenses_config.json"

fixture_db = {
    "tenants": [{"id": "t1", "name": "Empresa Teste"}],
    "users": [{"id": "u1", "tenant_id": "t1", "email": "dona@example.com", "name": "Dona da Conta"}],
    "categories": [{"id": "c1", "tenant_id": "t1", "name": "Transporte"}],
    "expenses": [],
    "payments": [],
    "budgets": [],
    "budgetLayouts": [],
    "categoryBudgets": [],
    "_seq": {},
}

emails_fake = [
    make_email("Pagamento aprovado - UBER *TRIP 123", "Você fez um pagamento de R$ 35,50 para UBER *TRIP 123.", msg_id="<e1@mp>"),
    make_email("Compra aprovada - LOJA QUALQUER XYZ", "Compra aprovada de R$ 89,90 em LOJA QUALQUER XYZ.", msg_id="<e2@mp>"),
    make_email("Você recebeu um pagamento", "Você recebeu um pagamento de R$ 19,99 via Pix.", msg_id="<e3@mp>"),  # receita -> ignorado
    make_email("Pagamento cancelado", "Seu pagamento de R$ 5,00 foi cancelado.", msg_id="<e4@mp>"),  # ignorar
    make_email("Assunto irrelevante do banco", "Nenhuma palavra-chave reconhecida aqui.", msg_id="<e5@mp>"),  # desconhecido -> ignorado
]

cfg = {
    "conta_email": "DONA@EXAMPLE.COM",  # maiúsculo de propósito, mesma checagem case-insensitive de mp_expenses.py
    "mapeamento": [{"palavra_chave": "uber", "categoria": "Transporte"}],
    "categoria_padrao": "Mercado Pago (não categorizado)",
    "imap_server": "imap.example.com",
    "email_address": "caixa@example.com",
    "email_password": "fake",
}

with open(TEST_DB_PATH, "w", encoding="utf-8") as f:
    json.dump(fixture_db, f, ensure_ascii=False)
with open(TEST_CONFIG_PATH, "w", encoding="utf-8") as f:
    json.dump({**cfg, "db_json": TEST_DB_PATH}, f)

mpe.fetch_mp_emails = lambda cfg, dias: emails_fake

Args = argparse.Namespace(config=TEST_CONFIG_PATH, dias=30, firebase_service_account=None, db_json=None, dry_run=False)
resultado, msg = mpe.run(Args)
assert resultado == "ok", (resultado, msg)

with open(TEST_DB_PATH, encoding="utf-8") as f:
    depois = json.load(f)
novas = [e for e in depois["expenses"] if e.get("generatedByMercadoPago")]
assert len(novas) == 2, novas
assert all(e.get("mercadoPagoSource") == "email" for e in novas), novas
print("OK run() end-to-end: gerou 2 despesas a partir dos e-mails (ignorou receita/cancelado/desconhecido), marcadas mercadoPagoSource='email'")

uber = next(e for e in novas if e["mercadoPagoPaymentId"] == "<e1@mp>")
categoria_uber = next(c for c in depois["categories"] if c["id"] == uber["category_id"])
assert categoria_uber["name"] == "Transporte" and categoria_uber["id"] == "c1"
print("OK run() categoriza pelo assunto do e-mail reaproveitando a categoria já existente (Transporte)")

# rodar de novo (mesmos e-mails) não duplica
resultado_dup, _ = mpe.run(Args)
assert resultado_dup == "sem_novidades", resultado_dup
with open(TEST_DB_PATH, encoding="utf-8") as f:
    depois2 = json.load(f)
assert len([e for e in depois2["expenses"] if e.get("generatedByMercadoPago")]) == 2
print("OK run() rodado de novo com os mesmos e-mails não duplica despesas (idempotente via Message-ID)")

# e-mail de conta inexistente -> erro claro
with open(TEST_CONFIG_PATH, "w", encoding="utf-8") as f:
    json.dump({**cfg, "db_json": TEST_DB_PATH, "conta_email": "ninguem@example.com"}, f)
resultado_erro, msg_erro = mpe.run(Args)
assert resultado_erro == "erro" and "ninguem@example.com" in msg_erro, (resultado_erro, msg_erro)
print("OK erro claro quando conta_email não corresponde a nenhum usuário")

# --dry-run não grava nada
with open(TEST_DB_PATH, "w", encoding="utf-8") as f:
    json.dump(fixture_db, f, ensure_ascii=False)
with open(TEST_CONFIG_PATH, "w", encoding="utf-8") as f:
    json.dump({**cfg, "db_json": TEST_DB_PATH}, f)
with open(TEST_DB_PATH, encoding="utf-8") as f:
    antes = json.load(f)

Args_dry = argparse.Namespace(config=TEST_CONFIG_PATH, dias=30, firebase_service_account=None, db_json=None, dry_run=True)
resultado_dry, _ = mpe.run(Args_dry)
assert resultado_dry == "ok"
with open(TEST_DB_PATH, encoding="utf-8") as f:
    depois_dry = json.load(f)
assert antes == depois_dry, "--dry-run não deveria gravar nada"
print("OK --dry-run não grava nada")

print("\nTODOS OS TESTES PASSARAM ✅")
