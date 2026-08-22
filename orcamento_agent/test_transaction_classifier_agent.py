import transaction_classifier_agent as agent
import tempfile
import os
import json

cfg = {
    "default_category": "Não categorizado",
    "min_confidence": 0.35,
    "category_profiles": [
        {"name": "Transporte", "keywords": ["uber", "99", "taxi"], "direction": "debit"},
        {"name": "Alimentação", "keywords": ["ifood", "restaurante", "lanchonete"], "direction": "debit"},
        {"name": "Receitas", "keywords": ["pix", "transferencia recebida", "deposito"], "direction": "credit"},
    ],
    "payment_type_profiles": [
        {"name": "PIX", "keywords": ["pix", "qr"]},
        {"name": "API", "keywords": ["api", "checkout", "subscription"]},
    ],
    "transaction_type_profiles": [
        {"name": "PIX", "keywords": ["pix", "transferencia pix"]},
        {"name": "API", "keywords": ["api", "checkout", "subscription"]},
    ],
    "movement_type_profiles": [
        {"name": "Feed", "keywords": ["feed", "historico"]},
        {"name": "Orçamento", "keywords": ["orcamento", "budget", "recebimento"]},
        {"name": "Despesas", "keywords": ["despesa", "compra", "pagamento"]},
        {"name": "PIX", "keywords": ["pix", "transferencia pix", "qr"]},
    ],
    "mercado_pago_budget": {"monthly_limit": 683.0},
}

runner = agent.TransactionClassificationRunner(cfg)

transactions = [
    {"id": "t1", "description": "UBER *TRIP 123", "transaction_amount": -35.5, "transaction_type": "cashout", "status": "approved"},
    {"id": "t2", "description": "IFOOD PEDIDO 998", "transaction_amount": -59.9, "transaction_type": "cashout", "status": "approved"},
    {"id": "t3", "description": "Transferencia recebida via Pix", "transaction_amount": 300.0, "transaction_type": "cashin", "payment_type_id": "pix", "status": "approved"},
    {"id": "t4", "description": "COMPRA API CHECKOUT", "transaction_amount": -20.0, "transaction_type": "cashout", "status": "pending"},
    {
        "id": "123456789",
        "payment_id": "123456789",
        "transaction_number": "987654321",
        "merchant_order_id": "444555666",
        "description": "partition_payment checkout assinatura",
        "transaction_amount": -120.0,
        "date_created": "2026-08-05T10:15:00Z",
        "transaction_type": "Pagamento importado (Mercado Pago)",
        "generated_by_mercado_pago": True,
        "generated_by_mercado_pago_source": "api",
        "status": "approved",
    },
    {
        "id": "111222333",
        "payment_id": "111222333",
        "transaction_number": "ABC123",
        "description": "partition_payment",
        "transaction_amount": -90.0,
        "date_created": "2026-08-12T08:00:00Z",
        "generated_by_mercado_pago": True,
        "generated_by_mercado_pago_source": "api",
        "status": "approved",
    },
    {
        "id": "222333444",
        "payment_id": "222333444",
        "description": "Pagamento importado (Mercado Pago) compra loja",
        "transaction_amount": -500.0,
        "date_created": "2026-08-20T13:00:00Z",
        "generated_by_mercado_pago": True,
        "generated_by_mercado_pago_source": "api",
        "status": "approved",
    },
    {
        "id": "333444555",
        "payment_id": "333444555",
        "description": "Recebimento Mercado Pago saldo conta",
        "transaction_amount": 150.0,
        "date_created": "2026-08-22T18:30:00Z",
        "generated_by_mercado_pago": True,
        "generated_by_mercado_pago_source": "api",
        "status": "approved",
    },
]

results = runner.classify_transactions(transactions)

r1 = next(r for r in results if r["id"] == "t1")
assert r1["classification"]["category"] == "Transporte", r1
assert r1["classification"]["confidence"] >= 0.35, r1
print("OK classifica UBER como Transporte")

r2 = next(r for r in results if r["id"] == "t2")
assert r2["classification"]["category"] == "Alimentação", r2
print("OK classifica IFOOD como Alimentação")

r3 = next(r for r in results if r["id"] == "t3")
assert r3["classification"]["category"] == "Receitas", r3
assert r3["classification"]["direction"] == "credit", r3
assert r3["classification"]["payment_type"] == "PIX", r3
assert r3["classification"]["transaction_type"] == "PIX_ENTRADA", r3
assert r3["classification"]["movement_type"] == "PIX", r3
assert r3["classification"]["verification"]["transaction_verified"] is True, r3
print("OK classifica entrada PIX como Receitas")

r4 = next(r for r in results if r["id"] == "t4")
assert r4["classification"]["category"] == "Não categorizado", r4
assert r4["classification"]["payment_type"] == "API", r4
assert r4["classification"]["transaction_type"] == "API_SAIDA", r4
assert r4["classification"]["movement_type"] == "Despesas", r4
assert r4["classification"]["verification"]["verification_status"] == "pending", r4
print("OK fallback de categoria e classifica tipo API/pendente")

r5 = next(r for r in results if r["id"] == "123456789")
v5 = r5["classification"]["verification"]
assert v5["transaction_verified"] is True, r5
assert v5["transaction_number_verification"]["numbers_verified"] is True, r5
assert v5["transaction_nature_verification"]["nature_verified"] is True, r5
assert v5["transaction_nature_verification"]["detected_origin"] == "Integração Mercado Pago API", r5
assert v5["transaction_nature_verification"]["partition_payment_detected"] is True, r5
assert v5["transaction_nature_verification"]["expected_transaction_type"] == "Pagamento importado (Mercado Pago)", r5
print("OK valida natureza da transação Mercado Pago (API + partition_payment + importado)")

r6 = next(r for r in results if r["id"] == "111222333")
v6 = r6["classification"]["verification"]
assert v6["transaction_number_verification"]["numbers_verified"] is False, r6
assert v6["transaction_verified"] is False, r6
print("OK reprova número de transação inválido no Mercado Pago")

r8 = next(r for r in results if r["id"] == "333444555")
assert r8["classification"]["movement_type"] == "Orçamento", r8
print("OK classifica recebimento Mercado Pago como Orçamento")

with tempfile.TemporaryDirectory() as td:
    input_path = os.path.join(td, "in.json")
    output_path = os.path.join(td, "out.json")
    with open(input_path, "w", encoding="utf-8") as f:
        json.dump({"transactions": transactions}, f)
    payload = runner.run(input_path, output_path)
    summary = payload["summary"]
    assert summary["movement_type_counts"]["Despesas"] >= 4, summary
    assert summary["movement_type_counts"]["PIX"] >= 1, summary
    assert summary["movement_type_counts"]["Orçamento"] >= 1, summary
    mp_budget = summary["mercado_pago_budget"]
    assert mp_budget["monthly_limit"] == 683.0, mp_budget
    agosto = mp_budget["monthly"]["2026-08"]
    assert agosto["spent"] == 710.0, agosto
    assert agosto["overage"] == 27.0, agosto
    assert agosto["within_budget"] is False, agosto
    assert agosto["status"] == "ESTOURADO", agosto
print("OK gera verificação de orçamento Mercado Pago (R$ 683/mês)")

print("\nTODOS OS TESTES PASSARAM ✅")
