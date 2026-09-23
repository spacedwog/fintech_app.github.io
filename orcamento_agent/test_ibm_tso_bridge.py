"""Teste do fluxo ativo do ibm_tso_bridge.py com mocks de rede."""

import argparse
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import ibm_tso_bridge


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        if isinstance(payload, str):
            self.text = payload
        else:
            self.text = json.dumps(payload, ensure_ascii=False)

    def json(self):
        if isinstance(self._payload, str):
            raise ValueError("not json")
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")


class FakeSession:
    def __init__(self):
        self.auth = None
        self.headers = {}
        self.posts = []
        self._responses = [
            FakeResponse({"servletKey": "SERVLET-001"}),
            FakeResponse('{"event_id":"evt-001","payment_id":"42","status_quitacao":"QUITADO","amount":"19.99"}'),
            FakeResponse("event_id=evt-002;payment_id=84;status_quitacao=LIQUIDADO"),
            FakeResponse({"ok": True}),
        ]

    def mount(self, *_args, **_kwargs):
        return None

    def post(self, url, json=None, timeout=None, verify=True):
        self.posts.append({"url": url, "json": json, "timeout": timeout, "verify": verify})
        return self._responses.pop(0)

    def close(self):
        return None


def test_run_active_mode():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        config_path = tmp_path / "ibm_tso_bridge_config.json"
        events_path = tmp_path / "events.json"
        config_path.write_text(
            json.dumps(
                {
                    "connection": {
                        "base_url": "https://mainframe.example.com:443",
                        "auth_mode": "basic",
                        "user": "tester",
                        "password": "safe-password",
                        "timeout_seconds": 15,
                        "retries": 1,
                        "retry_backoff_seconds": 0.1,
                        "verify_tls": True,
                    },
                    "tso": {
                        "start_path": "/zosmf/tsoApp/tso",
                        "command_path": "/zosmf/tsoApp/tso/{servlet_key}",
                        "logoff_path": "/zosmf/tsoApp/tso/{servlet_key}",
                        "start_payload": {"logonProcedure": "IZUFPROC"},
                        "command_payload_template": {"command": "{command}"},
                        "logoff_payload": {"command": "LOGOFF"},
                    },
                    "flow": {
                        "tenant_id": "global",
                        "source_system": "IBM_TSO",
                        "commands": [
                            "LIST EVENTO 1",
                            "LIST EVENTO 2",
                        ],
                    },
                    "output_events_json": str(events_path),
                }
            ),
            encoding="utf-8",
        )

        args = argparse.Namespace(
            config=str(config_path),
            output_events_json=None,
            dry_run=False,
        )

        fake_session = FakeSession()
        with patch.object(ibm_tso_bridge, "_build_session", return_value=(fake_session, 15)):
            status, message, summary, events = ibm_tso_bridge.run(args)

        assert status == "ok"
        assert "sucesso" in message.lower()
        assert summary["disabled"] is False
        assert summary["start_ok"] is True
        assert summary["logoff_ok"] is True
        assert summary["commands_count"] == 2
        assert summary["events_count"] == 2
        assert summary["written"] is True
        assert len(events) == 2
        assert events[0]["event_id"] == "evt-001"
        assert events[0]["tenant_id"] == "global"
        assert events[0]["status_quitacao"] == "QUITADO"
        assert events[0]["amount"] == 19.99
        assert events[1]["event_id"] == "evt-002"
        assert events[1]["status_quitacao"] == "LIQUIDADO"
        assert events_path.exists()

        written_events = json.loads(events_path.read_text(encoding="utf-8"))
        assert isinstance(written_events, list)
        assert len(written_events) == 2


def test_build_session_bearer_mode():
    os.environ["IBM_TSO_TEST_TOKEN"] = "abc123-token"
    session, timeout = ibm_tso_bridge._build_session(
        {
            "auth_mode": "bearer",
            "token_env": "IBM_TSO_TEST_TOKEN",
            "timeout_seconds": 11,
            "retries": 1,
            "retry_backoff_seconds": 0.1,
        }
    )
    try:
        assert session.headers["Authorization"].lower().startswith("bearer ")
        assert session.headers["Authorization"].endswith("abc123-token")
        assert timeout == 11
    finally:
        session.close()
        os.environ.pop("IBM_TSO_TEST_TOKEN", None)


if __name__ == "__main__":
    test_run_active_mode()
    test_build_session_bearer_mode()
    print("\nTESTE PASSOU ✅")
