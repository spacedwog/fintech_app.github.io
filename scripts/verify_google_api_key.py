#!/usr/bin/env python3
"""
scripts/verify_google_api_key.py

Valida (sem vazar) a variavel de ambiente OPENAI_API_KEY antes do deploy.

Uso local:
  export OPENAI_API_KEY="seu-token"
  python3 scripts/verify_google_api_key.py

No GitHub Actions, o token vem do secret do repositorio:
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

O script nunca imprime o token completo (so uma mascara) e nao falha o
deploy caso a chave nao esteja configurada -- apenas avisa, ja que nem
todo ambiente (ex.: PRs de forks) tem acesso a secrets.

Reescrito em POO: OpenAIApiKeyVerifier encapsula a variável de ambiente
esperada, a máscara e uma validação simples de formato.
"""
import os
import sys

ENV_VAR = "OPENAI_API_KEY"
# Tokens da OpenAI normalmente comecam com "sk-".
EXPECTED_PREFIX = "sk-"


class OpenAIApiKeyVerifier:
    def __init__(self, env_var=ENV_VAR, expected_prefix=EXPECTED_PREFIX):
        self.env_var = env_var
        self.expected_prefix = expected_prefix

    @staticmethod
    def mask(key: str) -> str:
        if len(key) <= 8:
            return "*" * len(key)
        return f"{key[:4]}{'*' * (len(key) - 8)}{key[-4:]}"

    def _problems(self, key: str):
        problems = []
        if not key.startswith(self.expected_prefix):
            problems.append(f"nao comeca com o prefixo esperado '{self.expected_prefix}'")
        if len(key) < 20:
            problems.append(f"tamanho muito curto ({len(key)})")
        return problems

    def verify(self) -> int:
        key = os.environ.get(self.env_var, "").strip()

        if not key:
            print(f"[verify_openai_api_key] AVISO: {self.env_var} nao esta definida neste ambiente.")
            print("[verify_openai_api_key] Configure o secret OPENAI_API_KEY no GitHub "
                  "(Settings > Secrets and variables > Actions) para habilitar as "
                  "chamadas que dependem dela.")
            # Nao derruba o pipeline: ha steps (lint/testes) que nao dependem da chave.
            return 0

        problems = self._problems(key)

        print(f"[verify_openai_api_key] {self.env_var} encontrada: {self.mask(key)}")

        if problems:
            print(f"[verify_openai_api_key] AVISO: formato incomum -> {', '.join(problems)}. "
                  "Confirme se e mesmo um token de API valido.")
        else:
            print("[verify_openai_api_key] Formato compativel com um token OpenAI.")

        return 0


def mask(key: str) -> str:
    return OpenAIApiKeyVerifier.mask(key)


def main() -> int:
    return OpenAIApiKeyVerifier().verify()


if __name__ == "__main__":
    sys.exit(main())
