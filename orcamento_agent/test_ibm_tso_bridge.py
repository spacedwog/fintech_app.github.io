"""Teste do modo desativado do ibm_tso_bridge.py."""

import argparse

import ibm_tso_bridge


def test_run_disabled_mode():
    args = argparse.Namespace(
        config="ibm_tso_bridge_config.json",
        output_events_json=None,
        dry_run=True,
    )
    status, message, summary, events = ibm_tso_bridge.run(args)
    assert status == "disabled"
    assert "removida com segurança" in message.lower()
    assert summary["disabled"] is True
    assert summary["events_count"] == 0
    assert summary["commands_count"] == 0
    assert summary["written"] is False
    assert events == []


if __name__ == "__main__":
    test_run_disabled_mode()
    print("\nTESTE PASSOU ✅")
