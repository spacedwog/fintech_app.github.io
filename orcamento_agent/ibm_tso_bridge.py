#!/usr/bin/env python3
"""Integração IBM Mainframe via z/OSMF TSO para geração de eventos financeiros."""

from __future__ import annotations

import argparse
import json
import os
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

DEFAULT_TIMEOUT_SECONDS = 30
DEFAULT_RETRIES = 3
DEFAULT_RETRY_BACKOFF_SECONDS = 1.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_join_url(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + "/" + path.lstrip("/")


def _as_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    text = str(value).strip().lower()
    if text in {"true", "1", "yes", "on"}:
        return True
    if text in {"false", "0", "no", "off"}:
        return False
    return default


def _load_json(path: str | None) -> Any:
    if not path:
        return None
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _save_json(path: str, payload: Any) -> None:
    Path(path).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_config(path: str) -> dict[str, Any]:
    if not Path(path).exists():
        raise ValueError(f"Arquivo de configuração não encontrado: {path}")
    config = _load_json(path)
    if not isinstance(config, dict):
        raise ValueError("Configuração inválida: JSON raiz deve ser objeto.")
    return config


def _deep_format(payload: Any, replacements: dict[str, str]) -> Any:
    if isinstance(payload, str):
        return payload.format(**replacements)
    if isinstance(payload, dict):
        return {key: _deep_format(value, replacements) for key, value in payload.items()}
    if isinstance(payload, list):
        return [_deep_format(item, replacements) for item in payload]
    return payload


def _parse_key_value_line(line: str) -> dict[str, Any] | None:
    if "=" not in line:
        return None
    parts = [chunk.strip() for chunk in line.split(";") if chunk.strip()]
    if not parts:
        return None

    event: dict[str, Any] = {}
    for part in parts:
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key:
            event[key] = value
    return event or None


def _normalize_event(
    event: dict[str, Any],
    tenant_id: str | None,
    source_system: str | None,
    command_index: int,
    line_index: int,
) -> dict[str, Any]:
    result = deepcopy(event)
    if not str(result.get("event_id") or "").strip():
        result["event_id"] = f"ibm-{command_index + 1}-{line_index + 1}-{uuid.uuid4().hex[:8]}"
    if tenant_id and not str(result.get("tenant_id") or "").strip():
        result["tenant_id"] = tenant_id
    if source_system and not str(result.get("source_system") or "").strip():
        result["source_system"] = source_system
    if not str(result.get("settled_at") or "").strip():
        result["settled_at"] = _now_iso()

    status = result.get("status_quitacao")
    if status is not None:
        result["status_quitacao"] = str(status).strip().upper()

    amount = result.get("amount")
    if amount is not None:
        try:
            result["amount"] = round(float(amount), 2)
        except (TypeError, ValueError):
            pass

    return result


def _extract_events_from_response(
    payload: Any,
    tenant_id: str | None,
    source_system: str | None,
    command_index: int,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []

    if isinstance(payload, dict):
        for key in ("events", "records", "items", "data"):
            nested = payload.get(key)
            if isinstance(nested, list):
                for idx, candidate in enumerate(nested):
                    if isinstance(candidate, dict):
                        events.append(_normalize_event(candidate, tenant_id, source_system, command_index, idx))
                if events:
                    return events

        line_candidates = []
        for key in ("tsoData", "output", "stdout", "result", "message"):
            value = payload.get(key)
            if isinstance(value, str):
                line_candidates.extend(value.splitlines())
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, str):
                        line_candidates.extend(item.splitlines())
                    elif isinstance(item, dict):
                        events.append(_normalize_event(item, tenant_id, source_system, command_index, len(events)))
        if events:
            return events
        payload = "\n".join(line_candidates)

    if isinstance(payload, list):
        for idx, candidate in enumerate(payload):
            if isinstance(candidate, dict):
                events.append(_normalize_event(candidate, tenant_id, source_system, command_index, idx))
            elif isinstance(candidate, str):
                parsed = _parse_key_value_line(candidate)
                if parsed:
                    events.append(_normalize_event(parsed, tenant_id, source_system, command_index, idx))
        return events

    if not isinstance(payload, str):
        payload = str(payload or "")

    for line_index, raw_line in enumerate(payload.splitlines()):
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("{") and line.endswith("}"):
            try:
                parsed_json = json.loads(line)
                if isinstance(parsed_json, dict):
                    events.append(_normalize_event(parsed_json, tenant_id, source_system, command_index, line_index))
                    continue
            except json.JSONDecodeError:
                pass
        parsed_kv = _parse_key_value_line(line)
        if parsed_kv:
            events.append(_normalize_event(parsed_kv, tenant_id, source_system, command_index, line_index))
    return events


def _resolve_secret_value(connection: dict[str, Any], plain_key: str, env_key: str) -> str | None:
    plain_value = connection.get(plain_key)
    if plain_value:
        return str(plain_value)
    env_name = connection.get(env_key)
    if env_name:
        return os.getenv(str(env_name))
    return None


def _build_session(connection: dict[str, Any]) -> tuple[requests.Session, int]:
    session = requests.Session()
    retries = int(connection.get("retries", DEFAULT_RETRIES))
    backoff = float(connection.get("retry_backoff_seconds", DEFAULT_RETRY_BACKOFF_SECONDS))
    retry = Retry(
        total=retries,
        connect=retries,
        read=retries,
        status=retries,
        backoff_factor=backoff,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET", "POST"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)

    auth_mode = str(connection.get("auth_mode", "basic")).strip().lower()
    if auth_mode == "basic":
        user = str(connection.get("user") or "").strip()
        password = _resolve_secret_value(connection, "password", "password_env")
        if not user or not password:
            raise ValueError("Credenciais basic ausentes: informe connection.user e password/password_env.")
        session.auth = (user, password)
    elif auth_mode == "bearer":
        token = _resolve_secret_value(connection, "token", "token_env")
        if not token:
            raise ValueError("Token bearer ausente: informe connection.token ou token_env.")
        session.headers["Authorization"] = "Bearer " + token
    else:
        raise ValueError(f"auth_mode inválido: {auth_mode}")

    session.headers["Accept"] = "application/json"
    session.headers["Content-Type"] = "application/json"
    timeout = int(connection.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS))
    return session, timeout


def _json_or_text(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return response.text


def _find_servlet_key(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("servletKey", "servletkey", "servlet_key"):
            value = payload.get(key)
            if value:
                return str(value).strip()
    return None


def run(args):
    summary = {
        "disabled": False,
        "events_count": 0,
        "commands_count": 0,
        "written": False,
        "start_ok": False,
        "logoff_ok": False,
        "errors": 0,
        "message": "",
    }
    events: list[dict[str, Any]] = []
    session = None
    servlet_key = None
    timeout = DEFAULT_TIMEOUT_SECONDS
    base_url = ""
    verify_tls = True
    logoff_path = ""
    logoff_payload = {"command": "LOGOFF"}

    try:
        config = _load_config(args.config)
        connection = config.get("connection") or {}
        tso = config.get("tso") or {}
        flow = config.get("flow") or {}
        commands = flow.get("commands") or []
        if not isinstance(commands, list) or not commands:
            raise ValueError("Nenhum comando TSO informado em flow.commands.")

        base_url = str(connection.get("base_url") or "").strip()
        if not base_url:
            raise ValueError("connection.base_url é obrigatório.")

        start_path = str(tso.get("start_path") or "").strip()
        command_path = str(tso.get("command_path") or "").strip()
        logoff_path = str(tso.get("logoff_path") or command_path).strip()
        if not start_path or not command_path:
            raise ValueError("tso.start_path e tso.command_path são obrigatórios.")

        start_payload = deepcopy(tso.get("start_payload") or {})
        command_payload_template = deepcopy(tso.get("command_payload_template") or {"command": "{command}"})
        logoff_payload = deepcopy(tso.get("logoff_payload") or {"command": "LOGOFF"})
        tenant_id = str(flow.get("tenant_id") or "").strip() or None
        source_system = str(flow.get("source_system") or "IBM_TSO").strip()

        session, timeout = _build_session(connection)
        verify_tls = _as_bool(connection.get("verify_tls", True), default=True)

        start_response = session.post(
            _safe_join_url(base_url, start_path),
            json=start_payload,
            timeout=timeout,
            verify=verify_tls,
        )
        start_response.raise_for_status()
        start_data = _json_or_text(start_response)
        servlet_key = _find_servlet_key(start_data)
        if not servlet_key:
            raise ValueError("Resposta do start TSO sem servlet key.")
        summary["start_ok"] = True

        for command_index, command in enumerate(commands):
            command_text = str(command or "").strip()
            if not command_text:
                continue
            replacements = {
                "command": command_text,
                "command_url": quote(command_text, safe=""),
                "servlet_key": servlet_key,
            }
            command_payload = _deep_format(command_payload_template, replacements)
            formatted_command_path = command_path.format(**replacements)
            command_response = session.post(
                _safe_join_url(base_url, formatted_command_path),
                json=command_payload,
                timeout=timeout,
                verify=verify_tls,
            )
            command_response.raise_for_status()
            payload = _json_or_text(command_response)
            command_events = _extract_events_from_response(payload, tenant_id, source_system, command_index)
            events.extend(command_events)
            summary["commands_count"] += 1

        output_path = args.output_events_json or config.get("output_events_json")
        if output_path and not args.dry_run:
            _save_json(output_path, events)
            summary["written"] = True

        summary["events_count"] = len(events)
        summary["message"] = "Integração IBM TSO concluída com sucesso."
        return "ok", summary["message"], summary, events
    except (requests.RequestException, ValueError, OSError, json.JSONDecodeError, RuntimeError) as exc:
        summary["errors"] += 1
        summary["events_count"] = len(events)
        summary["message"] = f"Falha na integração IBM TSO: {exc}"
        return "error", summary["message"], summary, events
    finally:
        if session and servlet_key:
            try:
                if base_url and logoff_path:
                    session.post(
                        _safe_join_url(base_url, logoff_path.format(servlet_key=servlet_key)),
                        json=logoff_payload,
                        timeout=timeout,
                        verify=verify_tls,
                    )
                    summary["logoff_ok"] = True
            except Exception:
                summary["logoff_ok"] = False
        if session:
            try:
                session.close()
            except Exception:
                pass


def build_parser():
    parser = argparse.ArgumentParser(description="Integração IBM Mainframe via z/OSMF TSO.")
    parser.add_argument("--config", default="ibm_tso_bridge_config.json")
    parser.add_argument("--output-events-json", default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    status, message, summary, _events = run(args)
    print(message)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if status == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
