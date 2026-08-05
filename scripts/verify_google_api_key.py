#!/usr/bin/env python3
"""
scripts/verify_google_api_key.py

Valida (sem vazar) a variavel de ambiente GOOGLE_API_KEY antes do deploy.

Uso local:
  export GOOGLE_API_KEY="sua-chave"
  python3 scripts/verify_google_api_key.py

No GitHub Actions, a chave vem do secret do repositorio:
  env:
    GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}

O script nunca imprime a chave completa (so uma mascara) e nao falha o
deploy caso a chave nao esteja configurada -- apenas avisa, ja que nem
todo ambiente (ex.: PRs de forks) tem acesso a secrets.
"""
import os
import sys

ENV_VAR = "GOOGLE_API_KEY"
# Chaves de API do Google normalmente comecam com "AIza" e tem ~39 chars.
EXPECTED_PREFIX = "AIza"
EXPECTED_LEN = 39


def mask(key: str) -> str:
    if len(key) <= 8:
        return "*" * len(key)
    return f"{key[:4]}{'*' * (len(key) - 8)}{key[-4:]}"


def main() -> int:
    key = os.environ.get(ENV_VAR, "").strip()

    if not key:
        print(f"[verify_google_api_key] AVISO: {ENV_VAR} nao esta definida neste ambiente.")
        print("[verify_google_api_key] Configure o secret GOOGLE_API_KEY no GitHub "
              "(Settings > Secrets and variables > Actions) para habilitar as "
              "chamadas que dependem dela.")
        # Nao derruba o pipeline: ha steps (lint/testes) que nao dependem da chave.
        return 0

    problems = []
    if not key.startswith(EXPECTED_PREFIX):
        problems.append(f"nao comeca com o prefixo esperado '{EXPECTED_PREFIX}'")
    if len(key) != EXPECTED_LEN:
        problems.append(f"tamanho {len(key)} (esperado {EXPECTED_LEN})")

    print(f"[verify_google_api_key] {ENV_VAR} encontrada: {mask(key)}")

    if problems:
        print(f"[verify_google_api_key] AVISO: formato incomum -> {', '.join(problems)}. "
              "Confirme se e mesmo uma Google API Key valida.")
    else:
        print("[verify_google_api_key] Formato compativel com uma Google API Key.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
