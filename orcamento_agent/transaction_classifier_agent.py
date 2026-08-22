#!/usr/bin/env python3
"""
Agente IA (heurístico) para classificação de transações financeiras.

Entrada: lista de transações (JSON) + perfis de categoria (config JSON).
Saída: categoria prevista, confiança e evidências por transação.
"""

import argparse
import json
import os
import re
import unicodedata
from typing import Dict, List, Optional

DEFAULT_CATEGORY = "Não categorizado"
DEFAULT_MIN_CONFIDENCE = 0.35
DEFAULT_PAYMENT_TYPE = "OUTROS"
DEFAULT_TX_TYPE = "OUTROS"
DEFAULT_KNOWN_MP_STATUSES = {
    "approved",
    "pending",
    "in_process",
    "authorized",
    "rejected",
    "cancelled",
    "refunded",
    "charged_back",
}


class TransactionClassifierAgent:
    def __init__(
        self,
        category_profiles=None,
        default_category=DEFAULT_CATEGORY,
        payment_type_profiles=None,
        transaction_type_profiles=None,
        known_mp_statuses=None,
    ):
        self.default_category = default_category or DEFAULT_CATEGORY
        self.category_profiles = category_profiles or []
        self.payment_type_profiles = payment_type_profiles or []
        self.transaction_type_profiles = transaction_type_profiles or []
        self.known_mp_statuses = set(known_mp_statuses or DEFAULT_KNOWN_MP_STATUSES)

    @staticmethod
    def _normalize(value):
        if value is None:
            return ""
        text = str(value).lower().strip()
        text = unicodedata.normalize("NFKD", text)
        return "".join(c for c in text if not unicodedata.combining(c))

    @staticmethod
    def _safe_float(value, fallback=0.0):
        try:
            return float(value)
        except (TypeError, ValueError):
            return fallback

    @staticmethod
    def _is_numeric_identifier(value):
        if value is None:
            return False
        text = str(value).strip()
        return bool(text) and re.fullmatch(r"\d+", text) is not None

    def _infer_direction(self, tx):
        raw = self._normalize(" ".join([
            str(tx.get("direction") or ""),
            str(tx.get("type") or ""),
            str(tx.get("operation_type") or ""),
            str(tx.get("transaction_type") or ""),
            str(tx.get("payment_type_id") or ""),
            str(tx.get("credit_debit_type") or ""),
            str(tx.get("creditDebitType") or ""),
        ]))
        if any(t in raw for t in ("credit", "entrada", "receb", "deposit", "cashin", "incoming", "transfer_in")):
            return "credit"
        if any(t in raw for t in ("debit", "saida", "pagamento", "cashout", "outgoing", "saque", "transfer_out")):
            return "debit"

        amount = self._safe_float(tx.get("transaction_amount", tx.get("amount", 0)))
        if amount < 0:
            return "debit"
        if amount > 0:
            return "credit"
        return None

    @staticmethod
    def _tokenize(desc_norm):
        return [t for t in re.split(r"[^a-z0-9]+", desc_norm) if t]

    def _score_profiles(self, haystack, tokens, profiles):
        best = {"name": None, "score": 0.0, "matched_keywords": []}
        for profile in profiles or []:
            profile_name = str(profile.get("name") or "").strip()
            if not profile_name:
                continue
            score = 0.0
            matches = []
            for kw in profile.get("keywords") or []:
                kw_norm = self._normalize(kw)
                if not kw_norm:
                    continue
                if " " in kw_norm:
                    if kw_norm in haystack:
                        score += 1.5
                        matches.append(kw)
                elif kw_norm in tokens:
                    score += 1.0
                    matches.append(kw)
            if score > best["score"]:
                best = {"name": profile_name, "score": score, "matched_keywords": matches}
        return best

    def _infer_payment_channel(self, transaction):
        raw = self._normalize(" ".join([
            str(transaction.get("payment_type_id") or ""),
            str(transaction.get("payment_method_id") or ""),
            str(transaction.get("description") or ""),
            str(transaction.get("statement_descriptor") or ""),
            str(transaction.get("operation_type") or ""),
            str(transaction.get("transaction_type") or ""),
            str(transaction.get("type") or ""),
            str(transaction.get("external_reference") or ""),
        ]))
        tokens = set(self._tokenize(raw))

        if any(t in raw for t in ("pix", "instant payment", "qr code", "copia e cola")):
            return "PIX"
        if any(t in raw for t in ("credit_card", "debit_card", "cartao", "visa", "master", "elo", "amex")):
            return "CARTAO"
        if any(t in raw for t in ("ticket", "boleto")):
            return "BOLETO"
        if any(t in raw for t in ("account_money", "saldo")):
            return "SALDO_CONTA"
        if any(t in raw for t in ("api", "sdk", "checkout", "subscription", "assinatura", "link de pagamento")):
            return "API"

        prof = self._score_profiles(raw, tokens, self.payment_type_profiles)
        if prof["name"] and prof["score"] > 0:
            return prof["name"]
        return DEFAULT_PAYMENT_TYPE

    def _infer_transaction_type(self, transaction, direction):
        raw = self._normalize(" ".join([
            str(transaction.get("transaction_type") or ""),
            str(transaction.get("operation_type") or ""),
            str(transaction.get("type") or ""),
            str(transaction.get("description") or ""),
            str(transaction.get("statement_descriptor") or ""),
            str(transaction.get("external_reference") or ""),
        ]))
        tokens = set(self._tokenize(raw))

        if any(t in raw for t in ("refund", "refunded", "chargeback", "devolucao", "estorno")):
            return "ESTORNO"

        prof = self._score_profiles(raw, tokens, self.transaction_type_profiles)
        if prof["name"] and prof["score"] > 0:
            base = prof["name"]
        else:
            base = self._infer_payment_channel(transaction)
            if base == DEFAULT_PAYMENT_TYPE:
                base = DEFAULT_TX_TYPE

        if direction == "credit":
            return f"{base}_ENTRADA"
        if direction == "debit":
            return f"{base}_SAIDA"
        return base

    def _verify_mercado_pago(self, transaction):
        status = self._normalize(transaction.get("status"))
        amount = transaction.get("transaction_amount", transaction.get("amount"))
        has_payment_id = transaction.get("id") is not None or transaction.get("payment_id") is not None
        amount_is_numeric = isinstance(amount, (int, float)) or str(amount).replace(".", "", 1).replace("-", "", 1).isdigit()
        known_status = status in self.known_mp_statuses if status else False
        is_mercado_pago = bool(transaction.get("generated_by_mercado_pago")) or bool(transaction.get("payment_id"))

        number_fields = ("id", "payment_id", "transaction_number", "merchant_order_id", "collector_id", "operation_id")
        transaction_numbers = {}
        for field in number_fields:
            value = transaction.get(field)
            if value is None or str(value).strip() == "":
                continue
            transaction_numbers[field] = {
                "value": str(value),
                "is_numeric": self._is_numeric_identifier(value),
            }
        all_numbers_numeric = bool(transaction_numbers) and all(item["is_numeric"] for item in transaction_numbers.values())
        numbers_verified = all_numbers_numeric

        nature_raw = self._normalize(" ".join([
            str(transaction.get("description") or ""),
            str(transaction.get("statement_descriptor") or ""),
            str(transaction.get("transaction_type") or ""),
            str(transaction.get("type") or ""),
            str(transaction.get("operation_type") or ""),
            str(transaction.get("external_reference") or ""),
            str(transaction.get("generated_by_mercado_pago_source") or ""),
        ]))
        has_partition_payment = "partition_payment" in nature_raw
        has_imported_mp_type = "pagamento importado" in nature_raw and "mercado pago" in nature_raw
        source = self._normalize(transaction.get("generated_by_mercado_pago_source"))
        source_api = source == "api" or "integracao mercado pago api" in nature_raw
        nature_is_mp = is_mercado_pago or has_imported_mp_type or has_partition_payment or "mercado pago" in nature_raw
        if source_api:
            detected_origin = "Integração Mercado Pago API"
        elif nature_is_mp:
            detected_origin = "Integração Mercado Pago"
        else:
            detected_origin = "Origem não identificada"
        nature_verified = bool(nature_is_mp and (has_imported_mp_type or is_mercado_pago))

        payment_verified = bool(has_payment_id and known_status)
        transaction_verified = bool(payment_verified and amount_is_numeric and (numbers_verified if is_mercado_pago else True))

        verification_status = "unknown"
        if status == "approved":
            verification_status = "approved"
        elif status in ("pending", "in_process", "authorized"):
            verification_status = "pending"
        elif status in ("rejected", "cancelled"):
            verification_status = "rejected"
        elif status in ("refunded", "charged_back"):
            verification_status = "reversed"

        return {
            "payment_verified": payment_verified,
            "transaction_verified": transaction_verified,
            "mercado_pago_status": status or "desconhecido",
            "verification_status": verification_status,
            "transaction_number_verification": {
                "numbers_verified": numbers_verified,
                "all_numbers_numeric": all_numbers_numeric,
                "numbers_checked": transaction_numbers,
                "reason": "Todos os números de transação identificados estão no formato numérico."
                if numbers_verified
                else "Há números de transação ausentes ou com formato inválido.",
            },
            "transaction_nature_verification": {
                "nature_verified": nature_verified,
                "is_imported_mercado_pago_payment": bool(nature_is_mp),
                "detected_origin": detected_origin,
                "source_api": source_api,
                "partition_payment_detected": has_partition_payment,
                "expected_transaction_type": "Pagamento importado (Mercado Pago)" if nature_is_mp else "Não identificado",
                "reason": "Natureza da transação Mercado Pago validada (origem/tipo/descrição)."
                if nature_verified
                else "Sem evidências suficientes para validar a natureza da transação Mercado Pago.",
            },
            "reason": "Status do Mercado Pago, dados mínimos (id + valor) e números/natureza da transação verificados."
            if transaction_verified
            else "Dados insuficientes, números inválidos ou status desconhecido no Mercado Pago.",
        }

    def classify(self, transaction, min_confidence=DEFAULT_MIN_CONFIDENCE):
        desc = transaction.get("description") or transaction.get("statement_descriptor") or ""
        desc_norm = self._normalize(desc)
        tokens = set(self._tokenize(desc_norm))
        direction = self._infer_direction(transaction)
        amount = self._safe_float(transaction.get("transaction_amount", transaction.get("amount", 0)))
        payment_type = self._infer_payment_channel(transaction)
        transaction_type = self._infer_transaction_type(transaction, direction)
        verification = self._verify_mercado_pago(transaction)

        best = {
            "category": self.default_category,
            "score": 0.0,
            "matched_keywords": [],
            "direction": direction,
            "reason": "Sem evidência suficiente para classificação específica.",
        }

        for profile in self.category_profiles:
            category_name = str(profile.get("name") or "").strip()
            if not category_name:
                continue

            profile_score = 0.0
            matches = []

            for kw in profile.get("keywords") or []:
                kw_norm = self._normalize(kw)
                if not kw_norm:
                    continue
                if " " in kw_norm:
                    if kw_norm in desc_norm:
                        profile_score += 1.5
                        matches.append(kw)
                elif kw_norm in tokens:
                    profile_score += 1.0
                    matches.append(kw)

            profile_direction = self._normalize(profile.get("direction"))
            if profile_direction in ("credit", "debit"):
                if direction == profile_direction:
                    profile_score += 0.5
                elif direction and direction != profile_direction:
                    profile_score -= 0.25

            min_amount = profile.get("min_amount")
            max_amount = profile.get("max_amount")
            if min_amount is not None and amount < self._safe_float(min_amount, amount):
                profile_score -= 0.5
            if max_amount is not None and amount > self._safe_float(max_amount, amount):
                profile_score -= 0.5

            if profile_score > best["score"]:
                best = {
                    "category": category_name,
                    "score": profile_score,
                    "matched_keywords": matches,
                    "direction": direction,
                    "reason": f"Palavras-chave encontradas: {', '.join(matches)}" if matches else "Pontuação por contexto de direção/valor.",
                }

        confidence = 0.0
        if best["score"] > 0:
            confidence = min(0.99, max(0.0, best["score"] / (best["score"] + 1.0)))

        if best["score"] <= 0 or confidence < float(min_confidence or 0):
            return {
                "category": self.default_category,
                "confidence": round(confidence, 4),
                "direction": direction,
                "payment_type": payment_type,
                "transaction_type": transaction_type,
                "verification": verification,
                "matched_keywords": best["matched_keywords"],
                "reason": "Confiança abaixo do mínimo; mantido fallback em categoria padrão.",
            }

        return {
            "category": best["category"],
            "confidence": round(confidence, 4),
            "direction": direction,
            "payment_type": payment_type,
            "transaction_type": transaction_type,
            "verification": verification,
            "matched_keywords": best["matched_keywords"],
            "reason": best["reason"],
        }


class TransactionClassificationRunner:
    def __init__(self, cfg):
        self.cfg = cfg or {}
        self.classifier = TransactionClassifierAgent(
            category_profiles=self.cfg.get("category_profiles") or [],
            default_category=self.cfg.get("default_category") or DEFAULT_CATEGORY,
            payment_type_profiles=self.cfg.get("payment_type_profiles") or [],
            transaction_type_profiles=self.cfg.get("transaction_type_profiles") or [],
            known_mp_statuses=self.cfg.get("known_mp_statuses") or list(DEFAULT_KNOWN_MP_STATUSES),
        )
        self.min_confidence = float(self.cfg.get("min_confidence", DEFAULT_MIN_CONFIDENCE))

    @staticmethod
    def _read_json(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _write_json(path, payload):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

    def classify_transactions(self, transactions):
        out = []
        for tx in transactions:
            classification = self.classifier.classify(tx, min_confidence=self.min_confidence)
            out.append({
                "id": tx.get("id"),
                "description": tx.get("description") or tx.get("statement_descriptor") or "",
                "amount": tx.get("transaction_amount", tx.get("amount", 0)),
                "classification": classification,
            })
        return out

    def run(self, input_path, output_path):
        payload = self._read_json(input_path)
        transactions = payload.get("transactions") if isinstance(payload, dict) else payload
        if not isinstance(transactions, list):
            raise RuntimeError("Entrada inválida: esperado JSON com lista de transações ou {'transactions': [...]}.")

        results = self.classify_transactions(transactions)
        summary = {
            "total_transactions": len(results),
            "classified": sum(1 for r in results if r["classification"]["category"] != self.classifier.default_category),
            "defaulted": sum(1 for r in results if r["classification"]["category"] == self.classifier.default_category),
        }
        output = {"summary": summary, "results": results}
        self._write_json(output_path, output)
        return output


def load_config(config_path):
    if not os.path.exists(config_path):
        raise RuntimeError(
            f"Config não encontrado: {config_path}. Copie transaction_classifier_config.example.json e ajuste os perfis."
        )
    with open(config_path, encoding="utf-8") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser(description="Classifica transações com um agente IA heurístico.")
    ap.add_argument("--input-json", required=True, help="Arquivo JSON com transações (lista ou {'transactions': [...]}).")
    ap.add_argument("--output-json", default="transaction_classification_output.json", help="Arquivo de saída com classificações.")
    ap.add_argument(
        "--config",
        default="transaction_classifier_config.json",
        help="Config do agente (veja transaction_classifier_config.example.json).",
    )
    args = ap.parse_args()

    cfg = load_config(args.config)
    runner = TransactionClassificationRunner(cfg)
    output = runner.run(args.input_json, args.output_json)
    print(
        "✅ Classificação concluída: "
        f"{output['summary']['classified']}/{output['summary']['total_transactions']} transação(ões) classificadas. "
        f"Saída: {args.output_json}"
    )


if __name__ == "__main__":
    main()
