import transaction_classifier_agent as agent

cfg = {
    "default_category": "Não categorizado",
    "min_confidence": 0.35,
    "category_profiles": [
        {"name": "Transporte", "keywords": ["uber", "99", "taxi"], "direction": "debit"},
        {"name": "Alimentação", "keywords": ["ifood", "restaurante", "lanchonete"], "direction": "debit"},
        {"name": "Receitas", "keywords": ["pix", "transferencia recebida", "deposito"], "direction": "credit"},
    ],
}

runner = agent.TransactionClassificationRunner(cfg)

transactions = [
    {"id": "t1", "description": "UBER *TRIP 123", "transaction_amount": -35.5, "transaction_type": "cashout"},
    {"id": "t2", "description": "IFOOD PEDIDO 998", "transaction_amount": -59.9, "transaction_type": "cashout"},
    {"id": "t3", "description": "Transferencia recebida via Pix", "transaction_amount": 300.0, "transaction_type": "cashin"},
    {"id": "t4", "description": "COMPRA LOJA QUALQUER", "transaction_amount": -20.0, "transaction_type": "cashout"},
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
print("OK classifica entrada PIX como Receitas")

r4 = next(r for r in results if r["id"] == "t4")
assert r4["classification"]["category"] == "Não categorizado", r4
print("OK fallback para categoria padrão quando não há evidência")

print("\nTODOS OS TESTES PASSARAM ✅")
