#!/usr/bin/env python3
"""Ponte COBOL para reconciliação financeira local via eventos JSON."""

from __future__ import annotations

import argparse
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STATE_FIELD = "cobol_bridge_state"
SETTLED_STATUSES = {"QUITADO", "LIQUIDADO", "SETTLED", "PAID", "APPROVED"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _norm_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().upper()


def _parse_amount(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _event_is_settled(event: dict[str, Any]) -> bool:
    return _norm_text(event.get("status_quitacao")) in SETTLED_STATUSES


def _event_identifier(event: dict[str, Any]) -> str:
    for key in ("event_id", "id", "liquidation_reference"):
        value = event.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _tenant_matches(event: dict[str, Any], tenant_filter: str | None) -> bool:
    if not tenant_filter:
        return True
    return str(event.get("tenant_id") or "").strip() == str(tenant_filter).strip()


def _candidate_matches_event(payment: dict[str, Any], event: dict[str, Any]) -> bool:
    event_payment_id = event.get("payment_id")
    if event_payment_id is not None and str(event_payment_id).strip():
        return str(payment.get("id")) == str(event_payment_id)

    event_txid = event.get("txid")
    if event_txid is not None and str(event_txid).strip():
        return str(payment.get("txid") or "").strip() == str(event_txid).strip()

    event_amount = _parse_amount(event.get("amount"))
    payment_amount = _parse_amount(payment.get("amount"))
    if event_amount is None or payment_amount is None:
        return False
    if event_amount != payment_amount:
        return False

    event_tenant = str(event.get("tenant_id") or "").strip()
    payment_tenant = str(payment.get("tenant_id") or "").strip()
    if event_tenant and payment_tenant:
        return event_tenant == payment_tenant
    return True


def _find_payment_index(payments: list[dict[str, Any]], event: dict[str, Any]) -> int:
    matches = [i for i, payment in enumerate(payments) if _candidate_matches_event(payment, event)]
    if len(matches) == 1:
        return matches[0]
    return -1


def _apply_settlement(payment: dict[str, Any], event: dict[str, Any]) -> None:
    payment["verifiedByAI"] = True
    payment["status"] = "approved"
    payment["verifiedAt"] = event.get("settled_at") or _now_iso()
    payment["verifiedSource"] = "COBOL"
    payment["cobolEventId"] = _event_identifier(event)
    if event.get("liquidation_reference"):
        payment["cobolLiquidationReference"] = event["liquidation_reference"]


def reconcile_events(payments, events, state=None, tenant_filter=None):
    """Reconcilia pagamentos locais com eventos de liquidação vindos do COBOL."""
    copied_payments = deepcopy(payments or [])
    state_in = dict(state or {})
    cobol_state = dict(state_in.get(STATE_FIELD) or {})
    processed_event_ids = set(cobol_state.get("processed_event_ids") or [])

    summary = {
        "disabled": False,
        "tenant_filter": tenant_filter,
        "processed": 0,
        "matched": 0,
        "unmatched": 0,
        "duplicates": 0,
        "errors": 0,
        "total_events": 0,
        "validated_events": 0,
        "unmatched_events": [],
        "message": "Reconciliação COBOL concluída.",
    }

    for raw_event in events or []:
        summary["total_events"] += 1

        if not isinstance(raw_event, dict):
            summary["errors"] += 1
            continue

        if not _tenant_matches(raw_event, tenant_filter):
            continue

        if not _event_is_settled(raw_event):
            continue

        event_id = _event_identifier(raw_event)
        if event_id and event_id in processed_event_ids:
            summary["duplicates"] += 1
            continue

        summary["validated_events"] += 1
        summary["processed"] += 1

        match_index = _find_payment_index(copied_payments, raw_event)
        if match_index < 0:
            summary["unmatched"] += 1
            summary["unmatched_events"].append(
                {
                    "event_id": event_id or None,
                    "tenant_id": raw_event.get("tenant_id"),
                    "payment_id": raw_event.get("payment_id"),
                    "txid": raw_event.get("txid"),
                    "amount": raw_event.get("amount"),
                }
            )
        else:
            _apply_settlement(copied_payments[match_index], raw_event)
            summary["matched"] += 1

        if event_id:
            processed_event_ids.add(event_id)

    cobol_state["processed_event_ids"] = sorted(processed_event_ids)
    cobol_state["updated_at"] = _now_iso()
    state_out = dict(state_in)
    state_out[STATE_FIELD] = cobol_state

    return copied_payments, state_out, summary


def _load_json(path: str | None):
    if not path:
        return None
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _save_json(path: str, payload: Any):
    Path(path).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def run(args):
    config = _load_json(args.config) if args.config and Path(args.config).exists() else {}

    events_path = args.events_json or config.get("events_json")
    db_path = args.db_json or config.get("db_json")
    tenant_filter = args.tenant or config.get("tenant_filter")

    if not events_path:
        return "error", "Arquivo de eventos COBOL não informado.", {"disabled": False, "errors": 1}
    if not db_path:
        return "error", "Arquivo db.json não informado.", {"disabled": False, "errors": 1}

    db = _load_json(db_path)
    events = _load_json(events_path)

    if not isinstance(db, dict):
        return "error", "db.json inválido.", {"disabled": False, "errors": 1}
    if not isinstance(events, list):
        return "error", "events_json deve conter um array.", {"disabled": False, "errors": 1}

    payments = db.get("payments") or []
    state = db.get("runtime_state") or {}

    updated_payments, updated_state, summary = reconcile_events(
        payments,
        events,
        state=state,
        tenant_filter=tenant_filter,
    )

    db["payments"] = updated_payments
    db["runtime_state"] = updated_state

    if not args.dry_run:
        _save_json(db_path, db)

    status = "ok" if summary["errors"] == 0 else "error"
    message = "Reconciliação COBOL finalizada com sucesso." if status == "ok" else "Reconciliação COBOL concluída com erros."
    return status, message, summary


def build_parser():
    parser = argparse.ArgumentParser(
        description="Reconciliação financeira local usando eventos COBOL em JSON."
    )
    parser.add_argument("--config", default="cobol_bridge_config.json")
    parser.add_argument("--events-json")
    parser.add_argument("--db-json")
    parser.add_argument("--firebase-service-account")
    parser.add_argument("--tenant")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    status, message, summary = run(args)
    print(message)
    print(summary)
    return 0 if status == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
