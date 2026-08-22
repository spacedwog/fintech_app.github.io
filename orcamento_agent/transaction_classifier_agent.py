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
from typing import Dict, List, Optional

import mp_sync

DEFAULT_CATEGORY = "Não categorizado"
DEFAULT_MIN_CONFIDENCE = 0.35


class TransactionClassifierAgent:
    def __init__(self, category_profiles=None, default_category=DEFAULT_CATEGORY):
        self.default_category = default_category or DEFAULT_CATEGORY
        self.category_profiles = category_profiles or []

    @staticmethod
    def _normalize(value):
        return mp_sync.normalize(value)

    @staticmethod
    def _safe_float(value, fallback=0.0):
        try:
            return float(value)
        except (TypeError, ValueError):
            return fallback

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

    def classify(self, transaction, min_confidence=DEFAULT_MIN_CONFIDENCE):
        desc = transaction.get("description") or transaction.get("statement_descriptor") or ""
        desc_norm = self._normalize(desc)
        tokens = set(self._tokenize(desc_norm))
        direction = self._infer_direction(transaction)
        amount = self._safe_float(transaction.get("transaction_amount", transaction.get("amount", 0)))

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
                "matched_keywords": best["matched_keywords"],
                "reason": "Confiança abaixo do mínimo; mantido fallback em categoria padrão.",
            }

        return {
            "category": best["category"],
            "confidence": round(confidence, 4),
            "direction": direction,
            "matched_keywords": best["matched_keywords"],
            "reason": best["reason"],
        }


class TransactionClassificationRunner:
    def __init__(self, cfg):
        self.cfg = cfg or {}
        self.classifier = TransactionClassifierAgent(
            category_profiles=self.cfg.get("category_profiles") or [],
            default_category=self.cfg.get("default_category") or DEFAULT_CATEGORY,
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
