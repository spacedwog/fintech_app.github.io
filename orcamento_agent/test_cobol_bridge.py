"""Teste do fluxo ativo do cobol_bridge.py."""

import argparse
import json
import tempfile
from pathlib import Path

import cobol_bridge


fixture_db = {
    "payments": [
        {"id": "1", "tenant_id": "t1", "txid": "PIX-AAA", "amount": 19.99, "verifiedByAI": False},
        {"id": "2", "tenant_id": "t2", "txid": "PIX-BBB", "amount": 9.99, "verifiedByAI": False},
    ],
    "runtime_state": {},
}
fixture_events = [
    {"event_id": "evt-1", "tenant_id": "t1", "payment_id": "1", "status_quitacao": "QUITADO"},
    {"event_id": "evt-1", "tenant_id": "t1", "payment_id": "1", "status_quitacao": "QUITADO"},
    {"event_id": "evt-2", "tenant_id": "t1", "txid": "PIX-AAA", "status_quitacao": "LIQUIDADO"},
    {"event_id": "evt-3", "tenant_id": "t2", "payment_id": "2", "status_quitacao": "PENDENTE"},
]


updated_payments, updated_state, summary = cobol_bridge.reconcile_events(
    fixture_db["payments"], fixture_events, state=fixture_db["runtime_state"]
)

assert summary["disabled"] is False
assert summary["matched"] == 2
assert summary["duplicates"] == 1
assert summary["processed"] == 2
assert summary["unmatched"] == 0

by_id = {p["id"]: p for p in updated_payments}
assert by_id["1"].get("verifiedByAI") is True
assert by_id["1"].get("verifiedSource") == "COBOL"
assert by_id["2"].get("verifiedByAI") is False

state_events = updated_state[cobol_bridge.STATE_FIELD]["processed_event_ids"]
assert state_events == ["evt-1", "evt-2"]
print("OK reconcile_events ativo")

with tempfile.TemporaryDirectory() as tmp_dir:
    db_path = Path(tmp_dir) / "db.json"
    events_path = Path(tmp_dir) / "events.json"
    db_path.write_text(json.dumps(fixture_db), encoding="utf-8")
    events_path.write_text(json.dumps(fixture_events), encoding="utf-8")

    args = argparse.Namespace(
        config="inexistente.json",
        events_json=str(events_path),
        db_json=str(db_path),
        firebase_service_account=None,
        tenant=None,
        dry_run=False,
    )
    status, message, summary_run = cobol_bridge.run(args)
    assert status == "ok"
    assert "sucesso" in message.lower()
    assert summary_run["matched"] == 2

    db_after = json.loads(db_path.read_text(encoding="utf-8"))
    assert db_after["payments"][0].get("verifiedByAI") is True
    assert cobol_bridge.STATE_FIELD in db_after["runtime_state"]

print("OK run ativo")
print("\nTESTE PASSOU ✅")
