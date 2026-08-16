"""Teste do modo desativado do cobol_bridge.py."""

import argparse

import cobol_bridge


fixture_db = {
    "payments": [
        {"id": "1", "tenant_id": "t1", "txid": "PIX-AAA", "amount": 19.99, "verifiedByAI": False},
    ],
    "users": [{"id": "u1"}],
}
fixture_events = [{"event_id": "evt-1", "tenant_id": "t1", "payment_id": "1", "status_quitacao": "QUITADO"}]


updated_payments, updated_state, summary = cobol_bridge.reconcile_events(fixture_db["payments"], fixture_events, state={})
assert updated_payments == fixture_db["payments"]
assert updated_state == {}
assert summary["disabled"] is True
assert "desativado" in summary["message"].lower() or "removida" in summary["message"].lower()
print("OK reconcile_events desativado")

args = argparse.Namespace(
    config="cobol_bridge_config.json",
    events_json=None,
    db_json=None,
    firebase_service_account=None,
    tenant=None,
    dry_run=False,
)
status, message, summary_run = cobol_bridge.run(args)
assert status == "disabled"
assert summary_run["disabled"] is True
assert "removida" in message.lower() or "desativado" in message.lower()
print("OK run desativado")

print("\nTESTE PASSOU ✅")
