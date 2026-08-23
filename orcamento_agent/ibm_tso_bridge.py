#!/usr/bin/env python3
"""
Integração IBM Mainframe via TSO (z/OSMF) com sessão, retry e timeout.

Objetivo:
- Executar comandos TSO de forma segura fora do navegador.
- Normalizar a saída em eventos JSON idempotentes.
- Expor API interna simples para outros agentes Python.
"""

import argparse
import json
import os
import re
import time
from datetime import datetime, timezone
from uuid import uuid4


try:
    import requests
except ImportError as exc:  # pragma: no cover - proteção em runtime
    raise RuntimeError(
        "Falta o pacote 'requests'. Rode: pip install requests"
    ) from exc


DEFAULT_TIMEOUT = 30
DEFAULT_RETRIES = 3
DEFAULT_BACKOFF = 1.0
DEFAULT_SOURCE = "IBM_TSO"


class BridgeError(RuntimeError):
    pass


class TSOClient:
    def __init__(self, config):
        conn = dict(config.get("connection") or {})
        tso = dict(config.get("tso") or {})
        self._flow = dict(config.get("flow") or {})
        self._session = requests.Session()

        self.base_url = str(conn.get("base_url") or "").rstrip("/")
        if not self.base_url:
            raise BridgeError("connection.base_url é obrigatório.")

        self.timeout = int(conn.get("timeout_seconds", DEFAULT_TIMEOUT))
        self.retries = int(conn.get("retries", DEFAULT_RETRIES))
        self.backoff = float(conn.get("retry_backoff_seconds", DEFAULT_BACKOFF))
        self.verify_tls = bool(conn.get("verify_tls", True))

        auth_mode = str(conn.get("auth_mode", "basic")).strip().lower()
        if auth_mode not in {"basic", "bearer"}:
            raise BridgeError("connection.auth_mode deve ser 'basic' ou 'bearer'.")
        self.auth_mode = auth_mode
        self.user = str(conn.get("user") or "")
        self.password = self._resolve_secret(
            inline_value=conn.get("password"),
            env_name=conn.get("password_env"),
        )
        self.token = self._resolve_secret(
            inline_value=conn.get("token"),
            env_name=conn.get("token_env"),
        )

        if self.auth_mode == "basic":
            if not self.user or not self.password:
                raise BridgeError(
                    "Autenticação basic exige connection.user e senha (password/password_env)."
                )
            self._session.auth = (self.user, self.password)
        else:
            if not self.token:
                raise BridgeError(
                    "Autenticação bearer exige token (connection.token ou connection.token_env)."
                )
            self._session.headers.update({"Authorization": "Bearer " + self.token})

        self._session.headers.update({"Content-Type": "application/json"})

        self.start_path = str(tso.get("start_path", "/zosmf/tsoApp/tso"))
        self.command_path = str(tso.get("command_path", "/zosmf/tsoApp/tso/{servlet_key}"))
        self.logoff_path = str(tso.get("logoff_path", "/zosmf/tsoApp/tso/{servlet_key}"))
        self.start_payload = dict(
            tso.get(
                "start_payload",
                {
                    "account": tso.get("account", ""),
                    "codePage": tso.get("code_page", "1047"),
                    "logonProcedure": tso.get("logon_procedure", "IZUFPROC"),
                    "regionSize": tso.get("region_size", 0),
                },
            )
            or {}
        )
        self.command_payload_template = dict(
            tso.get("command_payload_template", {"command": "{command}"}) or {}
        )
        self.logoff_payload = dict(tso.get("logoff_payload", {"command": "LOGOFF"}) or {})

        self.servlet_key = None

    @staticmethod
    def _resolve_secret(inline_value=None, env_name=None):
        if inline_value not in (None, ""):
            return str(inline_value)
        if env_name:
            env_val = os.getenv(str(env_name), "")
            if env_val:
                return env_val
        return ""

    def _url(self, path):
        if not path.startswith("/"):
            path = "/" + path
        return f"{self.base_url}{path}"

    def _request(self, method, path, payload=None):
        last_error = None
        url = self._url(path)
        for attempt in range(1, self.retries + 1):
            try:
                resp = self._session.request(
                    method=method,
                    url=url,
                    json=payload,
                    timeout=self.timeout,
                    verify=self.verify_tls,
                )
                if 200 <= resp.status_code < 300:
                    return resp
                last_error = BridgeError(
                    f"HTTP {resp.status_code} em {path}: {resp.text[:300]}"
                )
            except requests.RequestException as exc:
                last_error = exc

            if attempt < self.retries:
                time.sleep(self.backoff * attempt)
        raise BridgeError(f"Falha na chamada {method} {path}: {last_error}")

    @staticmethod
    def _as_json(resp):
        try:
            return resp.json()
        except ValueError:
            return {"raw_text": resp.text}

    @staticmethod
    def _extract_servlet_key(data):
        for key in ("servletKey", "servlet_key", "tsoServletKey", "sessionKey", "id"):
            value = data.get(key)
            if value:
                return str(value)
        return ""

    def open(self):
        response = self._request("POST", self.start_path, self.start_payload)
        data = self._as_json(response)
        key = self._extract_servlet_key(data)
        if not key:
            raise BridgeError(
                "Não foi possível obter servlet_key da resposta de abertura da sessão TSO."
            )
        self.servlet_key = key
        return data

    def run_command(self, command):
        if not self.servlet_key:
            raise BridgeError("Sessão TSO não inicializada.")
        path = self.command_path.format(servlet_key=self.servlet_key)
        payload = json.loads(json.dumps(self.command_payload_template))
        for k, v in list(payload.items()):
            if isinstance(v, str):
                payload[k] = v.replace("{command}", command)
        response = self._request("POST", path, payload)
        return self._as_json(response)

    def close(self):
        if not self.servlet_key:
            return {"closed": False}
        path = self.logoff_path.format(servlet_key=self.servlet_key)
        try:
            resp = self._request("POST", path, self.logoff_payload)
            return self._as_json(resp)
        finally:
            self.servlet_key = None


def normalize_tso_response(raw):
    text_candidates = []
    for field in ("messageText", "tsoData", "output", "raw_text", "stdout"):
        val = raw.get(field)
        if isinstance(val, str) and val.strip():
            text_candidates.append(val)
        elif isinstance(val, list):
            text_candidates.extend(str(x) for x in val if str(x).strip())

    if not text_candidates:
        text_candidates = [json.dumps(raw, ensure_ascii=False)]

    lines = []
    for chunk in text_candidates:
        lines.extend([ln.strip() for ln in str(chunk).splitlines() if ln.strip()])

    return lines


KV_PATTERN = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)=([^;]+)")


def parse_events_from_lines(lines, tenant_id="global", source_system=DEFAULT_SOURCE):
    events = []
    for line in lines:
        parsed = None
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                parsed = obj
        except ValueError:
            parsed = None

        if parsed is None:
            pairs = dict((k, v.strip()) for k, v in KV_PATTERN.findall(line))
            if pairs:
                parsed = pairs

        if parsed is None:
            parsed = {"raw_line": line}

        normalized = dict(parsed)
        normalized.setdefault("tenant_id", tenant_id)
        normalized.setdefault("source_system", source_system)
        normalized.setdefault("status_quitacao", normalized.get("status") or "DESCONHECIDO")
        normalized.setdefault("event_id", f"tso-{uuid4().hex}")
        normalized.setdefault("settled_at", datetime.now(timezone.utc).isoformat())
        events.append(normalized)
    return events


def fetch_tso_events(config):
    flow = dict(config.get("flow") or {})
    commands = list(flow.get("commands") or [])
    if not commands:
        raise BridgeError("flow.commands deve conter ao menos um comando TSO.")

    tenant_id = str(flow.get("tenant_id", "global"))
    source_system = str(flow.get("source_system", DEFAULT_SOURCE))
    events = []
    command_runs = []

    client = TSOClient(config)
    client.open()
    try:
        for cmd in commands:
            raw = client.run_command(str(cmd))
            lines = normalize_tso_response(raw)
            cmd_events = parse_events_from_lines(
                lines,
                tenant_id=tenant_id,
                source_system=source_system,
            )
            command_runs.append(
                {
                    "command": cmd,
                    "output_lines": len(lines),
                    "events_parsed": len(cmd_events),
                }
            )
            events.extend(cmd_events)
    finally:
        client.close()

    return events, command_runs


def load_config(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


def run(args):
    config = load_config(args.config)
    output_path = args.output_events_json or config.get("output_events_json")
    dry_run = bool(args.dry_run)

    events, command_runs = fetch_tso_events(config)
    summary = {
        "ok": True,
        "events_count": len(events),
        "commands_count": len(command_runs),
        "dry_run": dry_run,
        "output_events_json": output_path,
        "command_runs": command_runs,
    }

    if output_path and not dry_run:
        write_json(output_path, events)
        summary["written"] = True
    else:
        summary["written"] = False

    return "ok", f"Integração TSO executada. Eventos: {len(events)}.", summary, events


def build_parser():
    parser = argparse.ArgumentParser(
        description="Integração IBM Mainframe via TSO (z/OSMF) para gerar eventos JSON."
    )
    parser.add_argument(
        "--config",
        default="ibm_tso_bridge_config.json",
        help="Arquivo de configuração JSON.",
    )
    parser.add_argument(
        "--output-events-json",
        default=None,
        help="Sobrescreve o caminho de saída de eventos no config.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Executa sem gravar arquivo de saída.",
    )
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        status, message, summary, _events = run(args)
        print(message)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0 if status == "ok" else 1
    except Exception as exc:  # pragma: no cover - proteção de CLI
        print(f"ERRO: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
