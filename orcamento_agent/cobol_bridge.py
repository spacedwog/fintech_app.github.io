#!/usr/bin/env python3
"""
Integração COBOL descontinuada.

Este módulo foi mantido apenas para compatibilidade operacional e agora
retorna status explícito de desativação sem tocar no banco de dados.
"""

import argparse
from copy import deepcopy

STATE_FIELD = "cobol_bridge_state"
DISABLED_MESSAGE = (
    "Integração COBOL removida com segurança: o agente cobol_bridge.py está desativado "
    "e não processa mais eventos."
)


def reconcile_events(payments, _events, state=None, tenant_filter=None):
    """Mantido só por compatibilidade com chamadas legadas de teste."""
    summary = {
        "disabled": True,
        "tenant_filter": tenant_filter,
        "processed": 0,
        "matched": 0,
        "unmatched": 0,
        "duplicates": 0,
        "errors": 0,
        "total_events": 0,
        "validated_events": 0,
        "unmatched_events": [],
        "message": DISABLED_MESSAGE,
    }
    return deepcopy(payments or []), dict(state or {}), summary


def run(_args):
    summary = {
        "disabled": True,
        "processed": 0,
        "matched": 0,
        "unmatched": 0,
        "duplicates": 0,
        "errors": 0,
        "message": DISABLED_MESSAGE,
    }
    return "disabled", DISABLED_MESSAGE, summary


def build_parser():
    parser = argparse.ArgumentParser(
        description="Integração COBOL descontinuada (mantido para compatibilidade de CLI)."
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
    return 0 if status == "disabled" else 1


if __name__ == "__main__":
    raise SystemExit(main())
