"""
Teste de integração do cobol_bridge.py sem Firestore real.
Cobre: contrato mínimo, idempotência por event_id, reconciliação e dry-run.
"""

import argparse
import json

import cobol_bridge

TEST_DB_PATH = "TEST_db_cobol_bridge.json"
TEST_EVENTS_PATH = "TEST_cobol_events.json"
TEST_CONFIG_PATH = "TEST_cobol_bridge_config.json"

fixture_db = {
    "payments": [
        {"id": "1", "tenant_id": "t1", "txid": "PIX-AAA", "amount": 19.99, "verifiedByAI": False},
        {"id": "2", "tenant_id": "t1", "txid": "PIX-BBB", "amount": 5.0, "verifiedByAI": False},
        {"id": "3", "tenant_id": "t2", "txid": "PIX-CCC", "amount": 10.0, "verifiedByAI": False},
    ],
    "users": [{"id": "u1"}],
}

fixture_events = [
    {
        "event_id": "evt-1",
        "tenant_id": "t1",
        "payment_id": "1",
        "status_quitacao": "QUITADO",
        "settled_at": "2026-08-16T10:00:00Z",
        "liquidation_reference": "LQ-001",
    },
    {
        "event_id": "evt-2",
        "tenant_id": "t1",
        "txid": "PIX-BBB",
        "status_quitacao": "PENDENTE",
        "settled_at": "2026-08-16T10:10:00Z",
        "liquidation_reference": "LQ-002",
    },
    {
        "event_id": "evt-3",
        "tenant_id": "t1",
        "amount": 777.77,
        "status_quitacao": "QUITADO",
    },
    {
        "event_id": "evt-1",
        "tenant_id": "t1",
        "payment_id": "1",
        "status_quitacao": "QUITADO",
    },
]


# ---------- reconcile_events() ----------
updated_payments, updated_state, summary = cobol_bridge.reconcile_events(
    fixture_db["payments"],
    fixture_events,
    state={},
)

by_id = {p["id"]: p for p in updated_payments}
assert by_id["1"]["settlementStatus"] == "QUITADO"
assert by_id["1"]["verifiedByCobol"] is True
assert by_id["1"]["cobolSettlement"]["liquidation_reference"] == "LQ-001"
assert len(by_id["1"]["settlementHistory"]) == 1

assert by_id["2"]["settlementStatus"] == "PENDENTE"
assert by_id["2"]["verifiedByCobol"] is False
assert len(by_id["2"]["settlementHistory"]) == 1

assert summary["matched"] == 2, summary
assert summary["unmatched"] == 1, summary
assert summary["duplicates"] == 1, summary
assert "evt-3" in summary["unmatched_events"]
assert "t1" in updated_state and "evt-1" in updated_state["t1"]["processed_event_ids"]
print("OK reconcile_events: contrato, idempotência e reconciliação")

# Não muta original
assert fixture_db["payments"][0].get("settlementStatus") is None
print("OK reconcile_events não muta a lista original")

# ---------- run() end-to-end ----------
with open(TEST_DB_PATH, "w", encoding="utf-8") as f:
    json.dump(fixture_db, f, ensure_ascii=False)

with open(TEST_EVENTS_PATH, "w", encoding="utf-8") as f:
    json.dump(fixture_events, f, ensure_ascii=False)

with open(TEST_CONFIG_PATH, "w", encoding="utf-8") as f:
    json.dump({"events_json": TEST_EVENTS_PATH, "db_json": TEST_DB_PATH}, f, ensure_ascii=False)

args = argparse.Namespace(
    config=TEST_CONFIG_PATH,
    events_json=None,
    db_json=None,
    firebase_service_account=None,
    tenant=None,
    dry_run=False,
)
status, message, summary_run = cobol_bridge.run(args)
assert status == "ok", (status, message)
assert summary_run["matched"] == 2

with open(TEST_DB_PATH, encoding="utf-8") as f:
    saved = json.load(f)
assert saved["payments"][0]["settlementStatus"] == "QUITADO"
assert saved["payments"][1]["settlementStatus"] == "PENDENTE"
assert cobol_bridge.STATE_FIELD in saved
print("OK run() grava conciliação e estado")

# ---------- dry-run não grava ----------
with open(TEST_DB_PATH, "w", encoding="utf-8") as f:
    json.dump(fixture_db, f, ensure_ascii=False)

with open(TEST_DB_PATH, encoding="utf-8") as f:
    before = json.load(f)

args_dry = argparse.Namespace(
    config=TEST_CONFIG_PATH,
    events_json=None,
    db_json=None,
    firebase_service_account=None,
    tenant=None,
    dry_run=True,
)
status_dry, _msg_dry, _summary_dry = cobol_bridge.run(args_dry)
assert status_dry == "ok"

with open(TEST_DB_PATH, encoding="utf-8") as f:
    after = json.load(f)
assert before == after
print("OK dry-run não grava")

print("\nTODOS OS TESTES PASSARAM ✅")
