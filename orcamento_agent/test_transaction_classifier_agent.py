import transaction_classifier_agent as agent

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
}

runner = agent.TransactionClassificationRunner(cfg)

transactions = [
    {"id": "t1", "description": "UBER *TRIP 123", "transaction_amount": -35.5, "transaction_type": "cashout", "status": "approved"},
    {"id": "t2", "description": "IFOOD PEDIDO 998", "transaction_amount": -59.9, "transaction_type": "cashout", "status": "approved"},
    {"id": "t3", "description": "Transferencia recebida via Pix", "transaction_amount": 300.0, "transaction_type": "cashin", "payment_type_id": "pix", "status": "approved"},
    {"id": "t4", "description": "COMPRA API CHECKOUT", "transaction_amount": -20.0, "transaction_type": "cashout", "status": "pending"},
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
assert r3["classification"]["verification"]["transaction_verified"] is True, r3
print("OK classifica entrada PIX como Receitas")

r4 = next(r for r in results if r["id"] == "t4")
assert r4["classification"]["category"] == "Não categorizado", r4
assert r4["classification"]["payment_type"] == "API", r4
assert r4["classification"]["transaction_type"] == "API_SAIDA", r4
assert r4["classification"]["verification"]["verification_status"] == "pending", r4
print("OK fallback de categoria e classifica tipo API/pendente")

print("\nTODOS OS TESTES PASSARAM ✅")
