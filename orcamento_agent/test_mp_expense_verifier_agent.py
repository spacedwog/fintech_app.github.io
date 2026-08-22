import mp_expense_verifier_agent as verifier_mod


agent = verifier_mod.MercadoPagoExpenseVerifierAgent()

base = {
    "status": "approved",
    "generated_by_mercado_pago": True,
    "generated_by_mercado_pago_source": "api",
    "operation_type": "cashout",
    "type": "Pagamento importado (Mercado Pago)",
}

tx_pix = {**base, "id": "9001", "payment_id": "9001", "transaction_amount": -10.0, "payment_type_id": "pix", "description": "Pagamento PIX mercado pago"}
tx_cartao = {**base, "id": "9002", "payment_id": "9002", "transaction_amount": -20.0, "payment_type_id": "credit_card", "description": "Compra visa mercado pago"}
tx_boleto = {**base, "id": "9003", "payment_id": "9003", "transaction_amount": -30.0, "payment_type_id": "ticket", "description": "Pagamento boleto mercado pago"}
tx_saldo = {**base, "id": "9004", "payment_id": "9004", "transaction_amount": -40.0, "payment_type_id": "account_money", "description": "Uso saldo conta mercado pago"}
tx_api = {**base, "id": "9005", "payment_id": "9005", "transaction_amount": -50.0, "payment_type_id": "digital_currency", "description": "partition_payment checkout api assinatura"}

for tx in [tx_pix, tx_cartao, tx_boleto, tx_saldo, tx_api]:
    result = agent.verify_one(tx)
    assert result["verified"] is True, result
    assert result["payment_type"] in {"PIX", "CARTAO", "BOLETO", "SALDO_CONTA", "API"}, result
print("OK cobre verificação de despesa para PIX/cartão/boleto/saldo/API")

no_receipt = agent.verify_one(tx_pix)
assert no_receipt["receipt_detected"] is False, no_receipt
assert no_receipt["receipt_confidence"] == 0.0, no_receipt
print("OK caso sem comprovante mantém receipt_detected=false")

duplicada = agent.verify_one(tx_pix, existing_transaction_ids=["9001"])
assert duplicada["verified"] is False, duplicada
assert "duplicado" in duplicada["verification_reason"], duplicada
print("OK transação duplicada é rejeitada")

receipt_ok = agent.verify_one(
    {**tx_api, "transaction_number": "999888777666"},
    receipt_data={"rawText": "Comprovante Mercado Pago\nNúmero da transação: 999888777666", "confidence": 0.87},
)
assert receipt_ok["receipt_detected"] is True, receipt_ok
assert receipt_ok["receipt_transaction_number"] == "999888777666", receipt_ok
assert receipt_ok["verified"] is True, receipt_ok
print("OK extrai número da transação do comprovante")

receipt_mismatch = agent.verify_one(
    {**tx_api, "transaction_number": "111222333444"},
    receipt_data={"rawText": "Transação 999888777666"},
)
assert receipt_mismatch["verified"] is False, receipt_mismatch
assert "comprovante" in receipt_mismatch["verification_reason"], receipt_mismatch
print("OK reprova quando número do comprovante diverge da API")

batch = agent.verify_transactions([tx_pix, tx_pix], receipts_by_transaction_id={})
assert batch[0]["verified"] is True and batch[1]["verified"] is False, batch
print("OK verifica duplicidade também no processamento em lote")

print("\nTODOS OS TESTES PASSARAM ✅")
