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

Reescrito em POO: GoogleApiKeyVerifier encapsula a variável de ambiente
esperada, a máscara e a validação de formato.
"""
import os
import sys

ENV_VAR = "GOOGLE_API_KEY"
# Chaves de API do Google normalmente comecam com "AIza" e tem ~39 chars.
EXPECTED_PREFIX = "AIza"
EXPECTED_LEN = 39


class GoogleApiKeyVerifier:
    def __init__(self, env_var=ENV_VAR, expected_prefix=EXPECTED_PREFIX, expected_len=EXPECTED_LEN):
        self.env_var = env_var
        self.expected_prefix = expected_prefix
        self.expected_len = expected_len

    @staticmethod
    def mask(key: str) -> str:
        if len(key) <= 8:
            return "*" * len(key)
        return f"{key[:4]}{'*' * (len(key) - 8)}{key[-4:]}"

    def _problems(self, key: str):
        problems = []
        if not key.startswith(self.expected_prefix):
            problems.append(f"nao comeca com o prefixo esperado '{self.expected_prefix}'")
        if len(key) != self.expected_len:
            problems.append(f"tamanho {len(key)} (esperado {self.expected_len})")
        return problems

    def verify(self) -> int:
        key = os.environ.get(self.env_var, "").strip()

        if not key:
            print(f"[verify_google_api_key] AVISO: {self.env_var} nao esta definida neste ambiente.")
            print("[verify_google_api_key] Configure o secret GOOGLE_API_KEY no GitHub "
                  "(Settings > Secrets and variables > Actions) para habilitar as "
                  "chamadas que dependem dela.")
            # Nao derruba o pipeline: ha steps (lint/testes) que nao dependem da chave.
            return 0

        problems = self._problems(key)

        print(f"[verify_google_api_key] {self.env_var} encontrada: {self.mask(key)}")

        if problems:
            print(f"[verify_google_api_key] AVISO: formato incomum -> {', '.join(problems)}. "
                  "Confirme se e mesmo uma Google API Key valida.")
        else:
            print("[verify_google_api_key] Formato compativel com uma Google API Key.")

        return 0


def mask(key: str) -> str:
    return GoogleApiKeyVerifier.mask(key)


def main() -> int:
    return GoogleApiKeyVerifier().verify()


if __name__ == "__main__":
    sys.exit(main())
