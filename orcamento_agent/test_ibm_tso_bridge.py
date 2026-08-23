"""Teste unitário simples do ibm_tso_bridge.py (sem rede real)."""

import argparse
import json
import os
import tempfile

import ibm_tso_bridge


class FakeResponse:
    def __init__(self, status_code=200, data=None, text=""):
        self.status_code = status_code
        self._data = data
        self.text = text

    def json(self):
        if self._data is None:
            raise ValueError("sem json")
        return self._data


class FakeSession:
    def __init__(self, scripted_responses):
        self.scripted_responses = list(scripted_responses)
        self.auth = None
        self.headers = {}
        self.calls = []

    def request(self, method, url, json=None, timeout=None, verify=None):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "json": json,
                "timeout": timeout,
                "verify": verify,
            }
        )
        if not self.scripted_responses:
            return FakeResponse(500, text="no scripted response")
        return self.scripted_responses.pop(0)


def build_config_path(data):
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    return path


def test_run_happy_path_with_retry_and_parsing():
    scripted = [
        FakeResponse(503, text="temporarily unavailable"),
        FakeResponse(200, data={"servletKey": "abc123"}),
        FakeResponse(200, data={"output": "event_id=evt-1;payment_id=10;status_quitacao=QUITADO"}),
        FakeResponse(200, data={"output": "{\"event_id\":\"evt-2\",\"payment_id\":\"11\",\"status_quitacao\":\"LIQUIDADO\"}"}),
        FakeResponse(200, data={"ok": True}),
    ]

    fake = FakeSession(scripted)
    original_factory = ibm_tso_bridge.requests.Session
    ibm_tso_bridge.requests.Session = lambda: fake
    try:
        config = {
            "connection": {
                "base_url": "https://example-zosmf",
                "auth_mode": "basic",
                "user": "u1",
                "password": "p1",
                "timeout_seconds": 5,
                "retries": 2,
                "retry_backoff_seconds": 0.0,
                "verify_tls": True,
            },
            "tso": {
                "start_path": "/start",
                "command_path": "/cmd/{servlet_key}",
                "logoff_path": "/end/{servlet_key}",
                "command_payload_template": {"command": "{command}"},
                "logoff_payload": {"command": "LOGOFF"},
            },
            "flow": {
                "tenant_id": "t1",
                "source_system": "IBM_TSO",
                "commands": ["CMD1", "CMD2"],
            },
        }
        cfg_path = build_config_path(config)
        args = argparse.Namespace(config=cfg_path, output_events_json=None, dry_run=True)
        status, _message, summary, events = ibm_tso_bridge.run(args)
    finally:
        ibm_tso_bridge.requests.Session = original_factory
        if "cfg_path" in locals() and os.path.exists(cfg_path):
            os.remove(cfg_path)

    assert status == "ok"
    assert summary["commands_count"] == 2
    assert summary["events_count"] == 2
    assert summary["written"] is False
    assert len(events) == 2
    assert events[0]["event_id"] == "evt-1"
    assert events[1]["event_id"] == "evt-2"
    assert fake.calls[0]["url"].endswith("/start")
    assert fake.calls[1]["url"].endswith("/start")
    assert fake.calls[2]["url"].endswith("/cmd/abc123")
    assert fake.calls[4]["url"].endswith("/end/abc123")


if __name__ == "__main__":
    test_run_happy_path_with_retry_and_parsing()
    print("\nTESTE PASSOU ✅")
