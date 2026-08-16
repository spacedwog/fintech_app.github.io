#!/usr/bin/env python3
"""
Ponte de integração IBM COBOL -> painel web (Fintech Spacecworp).

Objetivo:
  Consumir eventos financeiros exportados por uma camada intermediária
  (arquivo JSON), reconciliar com pagamentos já existentes no banco do app
  e atualizar o status de quitação/liquidação com rastreabilidade e
  idempotência.

Por que existe:
  O frontend é estático (GitHub Pages) e não deve acoplar direto com legado
  COBOL nem receber segredos de infraestrutura. Esta ponte roda fora do
  navegador (local/CI), no mesmo padrão dos demais agentes de integração.

Contrato mínimo de evento (entrada JSON):
  {
    "event_id": "cbl-evt-0001",          # obrigatório, chave de idempotência
    "tenant_id": "t1",                   # opcional (default: "global")
    "tipo": "PAYMENT_SETTLEMENT",        # opcional, informativo
    "payment_id": "123",                 # opcional
    "txid": "PIXABC123",                 # opcional
    "amount": 19.99,                      # opcional, usado como fallback
    "status_quitacao": "QUITADO",        # obrigatório
    "settled_at": "2026-08-16T12:00:00Z",# opcional
    "liquidation_reference": "LQ-9988",  # opcional
    "source_system": "IBM_COBOL"         # opcional
  }

Uso:
  python3 cobol_bridge.py --events-json eventos.json --db-json ../db.json --dry-run
  python3 cobol_bridge.py --events-json eventos.json --config cobol_bridge_config.json
"""

import abc
import argparse
import json
import os
from datetime import datetime, timezone


DEFAULT_TENANT = "global"
STATE_FIELD = "cobol_bridge_state"
SUPPORTED_SETTLEMENT_STATUSES = {
    "QUITADO", "PENDENTE", "CANCELADO", "LIQUIDADO", "ERRO", "SETTLED", "PENDING", "CANCELED"
}
SETTLED_STATUSES = {"QUITADO", "LIQUIDADO", "SETTLED"}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_settlement_status(status):
    text = str(status or "").strip().upper()
    if text not in SUPPORTED_SETTLEMENT_STATUSES:
        raise ValueError(
            f"status_quitacao inválido: '{status}'. Use um de: {', '.join(sorted(SUPPORTED_SETTLEMENT_STATUSES))}"
        )
    aliases = {
        "SETTLED": "LIQUIDADO",
        "PENDING": "PENDENTE",
        "CANCELED": "CANCELADO",
    }
    return aliases.get(text, text)


def validate_event(event):
    if not isinstance(event, dict):
        raise ValueError("Evento inválido: cada item deve ser um objeto JSON")

    event_id = str(event.get("event_id") or "").strip()
    if not event_id:
        raise ValueError("Evento inválido: campo obrigatório 'event_id'")

    status = normalize_settlement_status(event.get("status_quitacao"))

    payment_id = event.get("payment_id")
    txid = event.get("txid")
    amount = _to_float(event.get("amount"))
    if not payment_id and not txid and amount is None:
        raise ValueError(
            f"Evento '{event_id}' inválido: informe ao menos payment_id, txid ou amount para reconciliar"
        )

    normalized = dict(event)
    normalized["event_id"] = event_id
    normalized["status_quitacao"] = status
    normalized["tenant_id"] = str(event.get("tenant_id") or DEFAULT_TENANT)
    if payment_id is not None:
        normalized["payment_id"] = str(payment_id)
    if txid is not None:
        normalized["txid"] = str(txid).strip()
    if amount is not None:
        normalized["amount"] = amount
    normalized["source_system"] = str(event.get("source_system") or "IBM_COBOL")
    return normalized


def _find_payment(payments, event):
    payment_id = str(event.get("payment_id") or "").strip()
    txid = str(event.get("txid") or "").strip().lower()
    amount = _to_float(event.get("amount"))

    if payment_id:
        for p in payments:
            if str(p.get("id")) == payment_id:
                return p

    if txid:
        for p in payments:
            if str(p.get("txid") or "").strip().lower() == txid:
                return p

    if amount is not None:
        candidates = [p for p in payments if _to_float(p.get("amount")) == amount]
        if len(candidates) == 1:
            return candidates[0]

    return None


def _ensure_tenant_state(state, tenant_id):
    tenant_state = dict((state or {}).get(tenant_id) or {})
    processed = list(tenant_state.get("processed_event_ids") or [])
    tenant_state["processed_event_ids"] = processed
    return tenant_state


def reconcile_events(payments, events, state=None, tenant_filter=None):
    updated_payments = [dict(p) for p in (payments or [])]
    global_state = dict(state or {})

    summary = {
        "total_events": 0,
        "validated_events": 0,
        "processed": 0,
        "matched": 0,
        "unmatched": 0,
        "duplicates": 0,
        "errors": 0,
        "unmatched_events": [],
    }

    for raw in events or []:
        summary["total_events"] += 1
        try:
            event = validate_event(raw)
            summary["validated_events"] += 1
        except ValueError:
            summary["errors"] += 1
            continue

        tenant_id = event["tenant_id"]
        if tenant_filter and tenant_id != tenant_filter:
            continue

        tenant_state = _ensure_tenant_state(global_state, tenant_id)
        processed_ids = tenant_state["processed_event_ids"]
        event_id = event["event_id"]

        if event_id in processed_ids:
            summary["duplicates"] += 1
            continue

        payment = _find_payment(updated_payments, event)
        if not payment:
            summary["unmatched"] += 1
            summary["unmatched_events"].append(event_id)
            processed_ids.append(event_id)
            tenant_state["updated_at"] = now_iso()
            global_state[tenant_id] = tenant_state
            summary["processed"] += 1
            continue

        history = list(payment.get("settlementHistory") or [])
        history.append(
            {
                "event_id": event_id,
                "status_quitacao": event["status_quitacao"],
                "settled_at": event.get("settled_at"),
                "liquidation_reference": event.get("liquidation_reference"),
                "source_system": event.get("source_system"),
                "processed_at": now_iso(),
            }
        )

        payment["settlementHistory"] = history
        payment["settlementStatus"] = event["status_quitacao"]
        payment["verifiedByCobol"] = event["status_quitacao"] in SETTLED_STATUSES
        payment["cobolSettlement"] = {
            "event_id": event_id,
            "status_quitacao": event["status_quitacao"],
            "settled_at": event.get("settled_at"),
            "liquidation_reference": event.get("liquidation_reference"),
            "source_system": event.get("source_system"),
            "amount": event.get("amount"),
            "txid": event.get("txid"),
            "updated_at": now_iso(),
        }

        processed_ids.append(event_id)
        tenant_state["updated_at"] = now_iso()
        global_state[tenant_id] = tenant_state

        summary["processed"] += 1
        summary["matched"] += 1

    summary["tenants"] = sorted(global_state.keys())
    return updated_payments, global_state, summary


class DataSource(abc.ABC):
    @abc.abstractmethod
    def read(self):
        raise NotImplementedError

    @abc.abstractmethod
    def write_fields(self, fields):
        raise NotImplementedError

    @abc.abstractmethod
    def describe(self):
        raise NotImplementedError


class LocalJsonSource(DataSource):
    def __init__(self, path):
        self.path = path

    def read(self):
        if not os.path.exists(self.path):
            raise FileNotFoundError(f"Arquivo não encontrado: {self.path}")
        with open(self.path, encoding="utf-8") as f:
            return json.load(f)

    def write_fields(self, fields):
        db = self.read()
        db.update(fields)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=2)

    def describe(self):
        return f"db.json local ({self.path})"


class FirestoreSource(DataSource):
    COLLECTION = "fintech_saas"
    DOC_ID = "db_v1"

    def __init__(self, service_account_path):
        try:
            import firebase_admin
            from firebase_admin import credentials, firestore
        except ImportError as exc:
            raise RuntimeError(
                "Falta o pacote 'firebase-admin'. Rode: pip install firebase-admin --break-system-packages"
            ) from exc

        if not firebase_admin._apps:
            cred = credentials.Certificate(service_account_path)
            firebase_admin.initialize_app(cred)
        self._client = firestore.client()
        self._ref = self._client.collection(self.COLLECTION).document(self.DOC_ID)

    def read(self):
        snap = self._ref.get()
        if not snap.exists:
            raise RuntimeError(f"Documento {self.COLLECTION}/{self.DOC_ID} não encontrado")
        return snap.to_dict()

    def write_fields(self, fields):
        self._ref.update(fields)

    def describe(self):
        return f"Firestore ({self.COLLECTION}/{self.DOC_ID})"


def load_events_json(path):
    if not path:
        raise RuntimeError("Informe --events-json ou 'events_json' no config")
    if not os.path.exists(path):
        raise RuntimeError(f"Arquivo de eventos não encontrado: {path}")
    with open(path, encoding="utf-8") as f:
        parsed = json.load(f)
    if not isinstance(parsed, list):
        raise RuntimeError("Arquivo de eventos inválido: esperado um array JSON")
    return parsed


def load_config(path):
    if not os.path.exists(path):
        raise FileNotFoundError(f"Arquivo de configuração não encontrado: {path}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_source(cfg, args):
    sa_path = args.firebase_service_account or cfg.get("firebase_service_account")
    if sa_path:
        if not os.path.exists(sa_path):
            raise RuntimeError(f"firebase_service_account não encontrado: {sa_path}")
        return FirestoreSource(sa_path)

    db_json = args.db_json or cfg.get("db_json")
    if not db_json:
        raise RuntimeError("Defina 'db_json' ou 'firebase_service_account' no config (ou via CLI)")
    return LocalJsonSource(db_json)


def run(args):
    try:
        cfg = load_config(args.config)
        source = build_source(cfg, args)
        events_path = args.events_json or cfg.get("events_json")
        events = load_events_json(events_path)

        db = source.read()
        payments = list(db.get("payments") or [])
        state = dict(db.get(STATE_FIELD) or {})

        updated_payments, updated_state, summary = reconcile_events(
            payments,
            events,
            state=state,
            tenant_filter=(args.tenant or cfg.get("tenant_filter")),
        )

        if not args.dry_run:
            source.write_fields({"payments": updated_payments, STATE_FIELD: updated_state})

        msg = (
            f"Fonte: {source.describe()} | eventos={summary['total_events']} "
            f"validados={summary['validated_events']} processados={summary['processed']} "
            f"casados={summary['matched']} não_casados={summary['unmatched']} "
            f"duplicados={summary['duplicates']} erros={summary['errors']}"
        )
        return "ok", msg, summary
    except Exception as exc:
        return "erro", str(exc), None


def build_parser():
    parser = argparse.ArgumentParser(
        description="Ponte de integração IBM COBOL -> painel web (conciliação de pagamentos)"
    )
    parser.add_argument("--config", default="cobol_bridge_config.json")
    parser.add_argument("--events-json", help="Arquivo JSON com os eventos exportados da camada intermediária COBOL")
    parser.add_argument("--db-json", help="Caminho do db.json/localStorage exportado")
    parser.add_argument("--firebase-service-account", help="Chave de conta de serviço do Firebase")
    parser.add_argument("--tenant", help="Filtra e processa somente este tenant_id")
    parser.add_argument("--dry-run", action="store_true", help="Não grava alterações no banco")
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    status, message, _summary = run(args)
    print(message)
    if status != "ok":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
