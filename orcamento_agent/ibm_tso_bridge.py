#!/usr/bin/env python3
"""
Integração IBM Mainframe via TSO descontinuada.

Este módulo foi mantido apenas para compatibilidade operacional e agora
retorna status explícito de desativação sem abrir sessão nem fazer chamadas
de rede para z/OSMF/TSO.
"""

import argparse
import json

DISABLED_MESSAGE = (
    "Integração IBM Mainframe removida com segurança: o conector ibm_tso_bridge.py "
    "está desativado e não executa mais comandos TSO."
)


def run(_args):
    summary = {
        "disabled": True,
        "events_count": 0,
        "commands_count": 0,
        "written": False,
        "message": DISABLED_MESSAGE,
    }
    return "disabled", DISABLED_MESSAGE, summary, []


def build_parser():
    parser = argparse.ArgumentParser(
        description="Integração IBM Mainframe via TSO descontinuada (compatibilidade de CLI)."
    )
    parser.add_argument("--config", default="ibm_tso_bridge_config.json", help="Mantido por compatibilidade.")
    parser.add_argument("--output-events-json", default=None, help="Mantido por compatibilidade.")
    parser.add_argument("--dry-run", action="store_true", help="Mantido por compatibilidade.")
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    status, message, summary, _events = run(args)
    print(message)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if status == "disabled" else 1


if __name__ == "__main__":
    raise SystemExit(main())
