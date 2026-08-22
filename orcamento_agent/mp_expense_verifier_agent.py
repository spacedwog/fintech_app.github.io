#!/usr/bin/env python3
"""
Agente de verificação de despesas do Mercado Pago.

Orquestra:
1) classificação/verificação da transação;
2) obtenção de número da transação (API e/ou comprovante OCR);
3) saída JSON padronizada por transação.
"""

import argparse
import json
import re

import transaction_classifier_agent


class MercadoPagoReceiptTransactionAgent:
    TX_PATTERNS = [
        re.compile(r"(?:transa(?:c|ç)(?:a|ã)o|transaction|n(?:u|ú)mero|numero|id)\D{0,16}(\d{6,})", re.IGNORECASE),
        re.compile(r"\b(\d{10,})\b"),
    ]

    @staticmethod
    def _extract_from_text(text):
        raw = str(text or "")
        for pattern in MercadoPagoReceiptTransactionAgent.TX_PATTERNS:
            match = pattern.search(raw)
            if match:
                return match.group(1)
        return ""

    def extract(self, transaction, receipt_data=None):
        receipt_data = receipt_data if isinstance(receipt_data, dict) else {}
        api_number = transaction_classifier_agent.TransactionClassifierAgent._extract_primary_transaction_number(transaction)
        raw_text = receipt_data.get("rawText") or receipt_data.get("text") or ""
        receipt_number = self._extract_from_text(raw_text) or str(receipt_data.get("transaction_number") or "").strip()
        confidence = transaction_classifier_agent.TransactionClassifierAgent._safe_float(
            receipt_data.get("receipt_confidence", receipt_data.get("confidence")), 0.0
        )
        confidence = max(0.0, min(1.0, confidence))

        return {
            "transaction_id": str(transaction.get("id") or transaction.get("payment_id") or ""),
            "transaction_number": api_number or receipt_number,
            "receipt_detected": bool(raw_text or receipt_data.get("receipt_detected")),
            "receipt_confidence": round(confidence, 4),
            "receipt_transaction_number": receipt_number or None,
            "source": "api+ocr" if api_number and receipt_number else ("api" if api_number else ("ocr" if receipt_number else "none")),
        }


class MercadoPagoExpenseVerifierAgent:
    def __init__(self, classifier=None, receipt_agent=None):
        self.classifier = classifier or transaction_classifier_agent.TransactionClassifierAgent()
        self.receipt_agent = receipt_agent or MercadoPagoReceiptTransactionAgent()

    def verify_one(self, transaction, existing_transaction_ids=None, receipt_data=None):
        receipt = self.receipt_agent.extract(transaction, receipt_data=receipt_data)
        verification = self.classifier.verify_expense_transaction(
            transaction,
            existing_transaction_ids=existing_transaction_ids,
            receipt_data=receipt,
        )
        return {
            "transaction_id": verification["transaction_id"],
            "transaction_number": verification["transaction_number"],
            "payment_type": verification["payment_type"],
            "verified": verification["verified"],
            "verification_reason": verification["verification_reason"],
            "receipt_detected": verification["receipt_detected"],
            "receipt_confidence": verification["receipt_confidence"],
            "receipt_transaction_number": verification.get("receipt_transaction_number"),
            "classification": verification.get("classification"),
            "checks": verification.get("checks"),
            "receipt_source": receipt.get("source"),
        }

    def verify_transactions(self, transactions, receipts_by_transaction_id=None):
        receipts_by_transaction_id = receipts_by_transaction_id or {}
        existing_ids = []
        results = []
        for tx in transactions or []:
            tx_id = str(tx.get("id") or tx.get("payment_id") or "")
            receipt_data = receipts_by_transaction_id.get(tx_id) or {}
            result = self.verify_one(tx, existing_transaction_ids=existing_ids, receipt_data=receipt_data)
            results.append(result)
            if tx_id:
                existing_ids.append(tx_id)
        return results


def main():
    ap = argparse.ArgumentParser(description="Verifica transações de despesas Mercado Pago e comprovante/número.")
    ap.add_argument("--input-json", required=True, help="JSON com {'transactions': [...], 'receipts_by_transaction_id': {...}}")
    ap.add_argument("--output-json", default="mp_expense_verification_output.json", help="Arquivo de saída")
    args = ap.parse_args()

    with open(args.input_json, encoding="utf-8") as f:
        payload = json.load(f)
    transactions = payload.get("transactions") if isinstance(payload, dict) else payload
    receipts = payload.get("receipts_by_transaction_id", {}) if isinstance(payload, dict) else {}
    if not isinstance(transactions, list):
        raise RuntimeError("Entrada inválida: esperado {'transactions': [...]} ou lista.")

    agent = MercadoPagoExpenseVerifierAgent()
    results = agent.verify_transactions(transactions, receipts_by_transaction_id=receipts)
    output = {
        "summary": {
            "total": len(results),
            "verified": sum(1 for r in results if r["verified"]),
            "rejected": sum(1 for r in results if not r["verified"]),
        },
        "results": results,
    }
    with open(args.output_json, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"✅ Verificação concluída: {output['summary']['verified']}/{output['summary']['total']} válidas. Saída: {args.output_json}")


if __name__ == "__main__":
    main()
