#!/usr/bin/env python3
"""
Sincroniza dados da conta Mercado Pago via OAuth (vendedor/usuário) para o painel.

O que faz:
  1) Obtém/renova access token OAuth do Mercado Pago.
  2) Consulta pagamentos, cobranças, saldo e movimentações permitidas.
  3) Atualiza o banco do painel (Firestore/db.json) sem criar telas novas.
  4) (Opcional) Projeta lançamentos de débito em despesas categorizadas.

Uso:
  python3 mp_oauth_account_sync.py --dry-run
  python3 mp_oauth_account_sync.py
  python3 mp_oauth_account_sync.py --dias 60

Config: mp_oauth_account_config.json (veja mp_oauth_account_config.example.json)
"""

import argparse
import json
import os
import secrets
import sys
import time
import traceback
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    sys.exit("Falta o pacote 'requests'. Rode: pip install requests --break-system-packages")

import mp_expenses
import mp_reconcile


DEFAULT_MP_API_BASE = "https://api.mercadopago.com"
DEFAULT_OAUTH_TOKEN_ENDPOINT = "https://api.mercadopago.com/oauth/token"
DEFAULT_PAYMENTS_ENDPOINT = "/v1/payments/search"
DEFAULT_CHARGES_ENDPOINT = "/merchant_orders/search"
DEFAULT_BALANCE_ENDPOINT = "/users/me"
DEFAULT_MOVEMENTS_ENDPOINT = "/v1/account/bank_report"
DEFAULT_CATEGORIA_PADRAO = "Mercado Pago (OAuth)"


def log(linha):
    try:
        base = os.path.dirname(os.path.abspath(__file__))
        logdir = os.path.join(base, "logs")
        os.makedirs(logdir, exist_ok=True)
        with open(os.path.join(logdir, "mp_oauth_account_sync.log"), "a", encoding="utf-8") as f:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            f.write(f"[{ts}] {linha}\n")
    except Exception:
        pass


def gen_id(prefix):
    ts = format(int(time.time() * 1000), "x")
    rand = secrets.token_hex(4)
    return f"{prefix}{ts}{rand}"


class MercadoPagoOAuthClient:
    def __init__(self, cfg):
        self.cfg = cfg
        self.base_url = (cfg.get("mercado_pago_api_base") or DEFAULT_MP_API_BASE).rstrip("/")
        self.token_endpoint = cfg.get("mercado_pago_oauth_token_endpoint") or DEFAULT_OAUTH_TOKEN_ENDPOINT
        self.timeout = int(cfg.get("http_timeout_seconds") or 30)
        self.max_retries = int(cfg.get("http_max_retries") or 3)

    def _request(self, method, url, headers=None, params=None, data=None, json_payload=None):
        last_error = None
        for tentativa in range(1, self.max_retries + 1):
            try:
                resp = requests.request(
                    method=method,
                    url=url,
                    headers=headers,
                    params=params,
                    data=data,
                    json=json_payload,
                    timeout=self.timeout,
                )
                if resp.status_code >= 500:
                    raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
                return resp
            except Exception as e:
                last_error = e
                if tentativa >= self.max_retries:
                    break
                time.sleep(min(2 ** (tentativa - 1), 5))
        raise RuntimeError(f"Falha HTTP após {self.max_retries} tentativa(s): {last_error}")

    def _oauth_token(self, payload):
        resp = self._request("POST", self.token_endpoint, data=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"OAuth Mercado Pago falhou ({resp.status_code}): {resp.text[:300]}")
        data = resp.json()
        token = data.get("access_token")
        if not token:
            raise RuntimeError("OAuth Mercado Pago retornou resposta sem access_token.")
        return {
            "access_token": token,
            "refresh_token": data.get("refresh_token"),
            "expires_in": data.get("expires_in"),
            "scope": data.get("scope"),
            "user_id": data.get("user_id"),
            "public_key": data.get("public_key"),
            "token_type": data.get("token_type") or "Bearer",
        }

    def exchange_authorization_code(self, code, redirect_uri):
        client_id = self.cfg.get("mercado_pago_oauth_client_id")
        client_secret = self.cfg.get("mercado_pago_oauth_client_secret")
        if not client_id or not client_secret:
            raise RuntimeError("Config OAuth incompleta (client_id/client_secret).")
        if not code:
            raise RuntimeError("authorization_code não informado.")
        payload = {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
        }
        if redirect_uri:
            payload["redirect_uri"] = redirect_uri
        return self._oauth_token(payload)

    def refresh_access_token(self, refresh_token):
        client_id = self.cfg.get("mercado_pago_oauth_client_id")
        client_secret = self.cfg.get("mercado_pago_oauth_client_secret")
        if not client_id or not client_secret:
            raise RuntimeError("Config OAuth incompleta (client_id/client_secret).")
        if not refresh_token:
            raise RuntimeError("refresh_token OAuth não informado.")
        payload = {
            "grant_type": "refresh_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
        }
        return self._oauth_token(payload)

    def _authorized_get(self, endpoint, access_token, params=None):
        if not endpoint:
            return None
        ep = endpoint if endpoint.startswith("http") else f"{self.base_url}{endpoint}"
        resp = self._request("GET", ep, headers={"Authorization": f"******"}, params=params)
        if resp.status_code == 404:
            return {"_unsupported": True, "status_code": 404, "body": resp.text[:300]}
        if resp.status_code >= 400:
            raise RuntimeError(f"Falha ao consultar {endpoint} ({resp.status_code}): {resp.text[:300]}")
        return resp.json()

    def fetch_payments(self, access_token, begin_date, end_date):
        endpoint = self.cfg.get("mercado_pago_payments_endpoint") or DEFAULT_PAYMENTS_ENDPOINT
        results = []
        offset = 0
        limit = 50
        while True:
            data = self._authorized_get(
                endpoint,
                access_token,
                params={
                    "range": "date_created",
                    "begin_date": begin_date,
                    "end_date": end_date,
                    "sort": "date_created",
                    "criteria": "desc",
                    "limit": limit,
                    "offset": offset,
                },
            )
            if not isinstance(data, dict):
                break
            page = data.get("results", [])
            results.extend(page)
            total = data.get("paging", {}).get("total", len(results))
            offset += limit
            if offset >= total or not page:
                break
        return results

    def fetch_charges(self, access_token, begin_date, end_date):
        endpoint = self.cfg.get("mercado_pago_charges_endpoint")
        if endpoint is None:
            endpoint = DEFAULT_CHARGES_ENDPOINT
        data = self._authorized_get(
            endpoint,
            access_token,
            params={
                "begin_date": begin_date,
                "end_date": end_date,
                "sort": "date_created",
                "criteria": "desc",
                "limit": 100,
            },
        )
        if isinstance(data, dict) and data.get("_unsupported"):
            return data
        if isinstance(data, dict):
            return data.get("results", data.get("elements", []))
        return data if isinstance(data, list) else []

    def fetch_balance(self, access_token):
        endpoint = self.cfg.get("mercado_pago_balance_endpoint")
        if endpoint is None:
            endpoint = DEFAULT_BALANCE_ENDPOINT
        return self._authorized_get(endpoint, access_token)

    def fetch_movements(self, access_token, begin_date, end_date):
        endpoint = self.cfg.get("mercado_pago_movements_endpoint")
        if endpoint is None:
            endpoint = DEFAULT_MOVEMENTS_ENDPOINT
        data = self._authorized_get(
            endpoint,
            access_token,
            params={"begin_date": begin_date, "end_date": end_date},
        )
        if isinstance(data, dict) and data.get("_unsupported"):
            return data
        if isinstance(data, dict):
            return (
                data.get("results")
                or data.get("movements")
                or data.get("items")
                or data.get("transactions")
                or []
            )
        return data if isinstance(data, list) else []


class OAuthAccountSyncEngine:
    def __init__(self, cfg):
        self.cfg = cfg
        self.project_expenses = bool(cfg.get("projetar_transacoes_em_despesas", True))
        self.max_snapshot_items = int(cfg.get("max_snapshot_items", 200))
        self.categorizer = mp_expenses.ExpenseCategorizer(
            mapeamento=cfg.get("mapeamento") or [],
            categoria_padrao=cfg.get("categoria_padrao") or DEFAULT_CATEGORIA_PADRAO,
            ignorar_descricoes=cfg.get("ignorar_descricoes_contendo") or [],
        )

    @staticmethod
    def _pick(obj, keys):
        for k in keys:
            v = (obj or {}).get(k)
            if v is not None and str(v).strip() != "":
                return v
        return None

    @staticmethod
    def _safe_float(value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _to_iso_date(value):
        s = str(value or "")
        if len(s) >= 10:
            return s[:10]
        return datetime.now(timezone.utc).date().isoformat()

    @staticmethod
    def _normalized_direction(record):
        raw = str(
            OAuthAccountSyncEngine._pick(
                record,
                [
                    "direction",
                    "type",
                    "operation_type",
                    "transaction_type",
                    "credit_debit_type",
                    "creditDebitType",
                ],
            )
            or ""
        ).lower()
        if "credit" in raw or "entrada" in raw or "deposit" in raw:
            return "credit"
        return "debit"

    @staticmethod
    def _status_ok(record):
        status = str(
            OAuthAccountSyncEngine._pick(
                record,
                ["status", "transaction_status", "state", "payment_status"],
            )
            or ""
        ).lower()
        if not status:
            return True
        return status in {"approved", "accredited", "settled", "posted", "completed", "success", "succeeded"}

    def _upsert_payments(self, db, tenant_id, user_id, oauth_payments):
        existing = list(db.get("payments", []))
        idx = {
            (p.get("tenant_id"), str(p.get("mercadoPagoOAuthPaymentId") or p.get("txid") or "")): i
            for i, p in enumerate(existing)
            if p.get("tenant_id") == tenant_id
        }
        created = 0
        updated = 0

        for p in oauth_payments:
            external_id = str(self._pick(p, ["id", "payment_id", "external_reference", "collector_id"]) or "")
            if not external_id:
                continue
            amount = self._safe_float(self._pick(p, ["transaction_amount", "amount", "total_paid_amount"]))
            if amount <= 0:
                continue

            row = {
                "tenant_id": tenant_id,
                "user_id": user_id,
                "type": "pix",
                "plan": None,
                "amount": amount,
                "txid": external_id,
                "verifiedByAI": True,
                "aiClassification": "mercado_pago_oauth",
                "verifiedByMercadoPago": True,
                "verifiedByMercadoPagoAt": datetime.now(timezone.utc).isoformat(),
                "mercadoPagoOAuthPaymentId": external_id,
                "mercadoPagoOAuthSource": "oauth",
                "date": self._to_iso_date(
                    self._pick(p, ["date_approved", "date_created", "date_last_updated"])
                ),
            }

            key = (tenant_id, external_id)
            pos = idx.get(key)
            if pos is None:
                row["id"] = gen_id("pay")
                existing.append(row)
                idx[key] = len(existing) - 1
                created += 1
            else:
                merged = dict(existing[pos])
                merged.update(row)
                existing[pos] = merged
                updated += 1

        db["payments"] = existing
        return created, updated

    def _project_expenses(self, db, tenant_id, user_id, oauth_payments, oauth_movements):
        candidates = []

        for p in oauth_payments:
            if not self._status_ok(p):
                continue
            amount = self._safe_float(self._pick(p, ["transaction_amount", "amount", "total_paid_amount"]))
            if amount <= 0:
                continue
            direction = self._normalized_direction(p)
            if direction != "debit":
                continue
            candidates.append(
                {
                    "id": str(self._pick(p, ["id", "payment_id", "external_reference"]) or ""),
                    "description": str(self._pick(p, ["description", "statement_descriptor", "reason"]) or "Pagamento Mercado Pago"),
                    "amount": amount,
                    "date": self._to_iso_date(self._pick(p, ["date_approved", "date_created", "date_last_updated"])),
                }
            )

        for m in oauth_movements:
            if not self._status_ok(m):
                continue
            direction = self._normalized_direction(m)
            if direction != "debit":
                continue
            amount = self._safe_float(self._pick(m, ["amount", "value", "net_amount", "transaction_amount"]))
            if amount <= 0:
                continue
            external_id = str(self._pick(m, ["id", "movement_id", "external_id", "transaction_id"]) or "")
            if not external_id:
                continue
            candidates.append(
                {
                    "id": external_id,
                    "description": str(self._pick(m, ["description", "detail", "merchant_name", "counterparty"]) or "Movimentação Mercado Pago"),
                    "amount": amount,
                    "date": self._to_iso_date(self._pick(m, ["date", "created_at", "date_created", "posted_at"])),
                }
            )

        existing_expenses = db.get("expenses", [])
        imported_ids = {
            e.get("mercadoPagoOAuthTransactionId")
            for e in existing_expenses
            if e.get("tenant_id") == tenant_id and e.get("mercadoPagoOAuthTransactionId")
        }

        created = 0
        categories_created = 0

        for c in candidates:
            if not c["id"] or c["id"] in imported_ids:
                continue
            if self.categorizer.should_ignore(c["description"]):
                continue

            categoria_nome = self.categorizer.categorize(c["description"])
            categoria, cat_created = mp_expenses.find_or_create_category(db, tenant_id, categoria_nome)
            if cat_created:
                categories_created += 1

            expense = {
                "id": gen_id("exp"),
                "tenant_id": tenant_id,
                "user_id": user_id,
                "category_id": categoria["id"],
                "amount": float(c["amount"]),
                "date": c["date"],
                "description": c["description"],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "is_extra": False,
                "extra_charge": 0,
                "generatedByMercadoPago": True,
                "mercadoPagoSource": "oauth",
                "mercadoPagoOAuthTransactionId": c["id"],
            }
            db.setdefault("expenses", []).append(expense)
            imported_ids.add(c["id"])
            created += 1

        return created, categories_created

    def sync(self, db, tenant_id, user_id, snapshot):
        payments = snapshot.get("payments") or []
        charges = snapshot.get("charges")
        balance = snapshot.get("balance")
        movements = snapshot.get("movements")

        if isinstance(charges, dict) and charges.get("_unsupported"):
            charges = []
        if isinstance(movements, dict) and movements.get("_unsupported"):
            movements = []
        if not isinstance(charges, list):
            charges = []
        if not isinstance(movements, list):
            movements = []

        p_created, p_updated = self._upsert_payments(db, tenant_id, user_id, payments)

        exp_created = 0
        cat_created = 0
        if self.project_expenses:
            exp_created, cat_created = self._project_expenses(db, tenant_id, user_id, payments, movements)

        oauth_data = dict(db.get("mercado_pago_oauth_data") or {})
        oauth_data[tenant_id] = {
            "at": datetime.now(timezone.utc).isoformat(),
            "payments_count": len(payments),
            "charges_count": len(charges),
            "movements_count": len(movements),
            "balance": balance,
            "charges_sample": charges[: self.max_snapshot_items],
            "movements_sample": movements[: self.max_snapshot_items],
        }
        db["mercado_pago_oauth_data"] = oauth_data

        return {
            "payments_synced_created": p_created,
            "payments_synced_updated": p_updated,
            "expenses_created": exp_created,
            "categories_created": cat_created,
            "payments_count": len(payments),
            "charges_count": len(charges),
            "movements_count": len(movements),
            "balance_found": bool(balance),
        }


class MercadoPagoOAuthAccountAgent:
    def __init__(self):
        self.oauth_client_cls = MercadoPagoOAuthClient

    @staticmethod
    def _resolve_tokens(client, cfg, args):
        if args.access_token:
            return {
                "access_token": args.access_token,
                "refresh_token": args.refresh_token or cfg.get("mercado_pago_oauth_refresh_token"),
                "expires_in": None,
                "scope": None,
                "user_id": None,
                "token_type": "Bearer",
            }

        static_token = cfg.get("mercado_pago_access_token")
        if static_token and not str(static_token).startswith("COLE_"):
            return {
                "access_token": static_token,
                "refresh_token": cfg.get("mercado_pago_oauth_refresh_token"),
                "expires_in": None,
                "scope": None,
                "user_id": None,
                "token_type": "Bearer",
            }

        auth_code = args.authorization_code or cfg.get("mercado_pago_oauth_authorization_code")
        if auth_code:
            return client.exchange_authorization_code(auth_code, cfg.get("mercado_pago_oauth_redirect_uri"))

        refresh_token = args.refresh_token or cfg.get("mercado_pago_oauth_refresh_token")
        if refresh_token:
            return client.refresh_access_token(refresh_token)

        raise RuntimeError(
            "Nenhuma credencial de acesso encontrada. Informe access token direto, ou configure OAuth "
            "(authorization_code/refresh_token + client_id/client_secret)."
        )

    def run(self, args):
        if not os.path.exists(args.config):
            return "erro", (
                f"Config não encontrado: {args.config}. Copie mp_oauth_account_config.example.json -> "
                f"{args.config} e preencha as credenciais."
            )

        with open(args.config, encoding="utf-8") as f:
            cfg = json.load(f)

        try:
            source = mp_reconcile.build_source(cfg, args)
        except Exception as e:
            return "erro", str(e)

        try:
            db = source.read()
        except Exception as e:
            return "erro", f"Falha ao ler os dados do app ({source.describe()}): {e}"

        conta_email = cfg.get("conta_email")
        if not conta_email:
            return "erro", "Informe 'conta_email' no config (conta do painel que recebe o sync)."

        user = mp_expenses.find_user_by_email(db, conta_email)
        if not user:
            return "erro", f"Ninguém com e-mail '{conta_email}' encontrado em {source.describe()}."

        tenant_id = user.get("tenant_id")
        user_id = user.get("id")

        dias = args.dias or cfg.get("janela_dias") or 30
        begin, end = mp_reconcile.day_range(dias)

        client = self.oauth_client_cls(cfg)
        try:
            token_info = self._resolve_tokens(client, cfg, args)
            access_token = token_info["access_token"]

            payments = client.fetch_payments(access_token, begin, end)

            charges = []
            if bool(cfg.get("consultar_cobrancas", True)):
                charges = client.fetch_charges(access_token, begin, end)

            balance = None
            if bool(cfg.get("consultar_saldo", True)):
                balance = client.fetch_balance(access_token)

            movements = []
            if bool(cfg.get("consultar_movimentacoes", True)):
                movements = client.fetch_movements(access_token, begin, end)
        except Exception as e:
            return "erro", f"Falha na consulta OAuth/conta Mercado Pago: {e}"

        resumo = OAuthAccountSyncEngine(cfg).sync(
            db,
            tenant_id,
            user_id,
            {
                "payments": payments,
                "charges": charges,
                "balance": balance,
                "movements": movements,
            },
        )

        if args.dry_run:
            linhas = ["[dry-run] Nada foi gravado. Resumo do que seria feito:"]
        else:
            try:
                status = mp_reconcile.StatusTracker.update(
                    db,
                    tenant_id,
                    "last_oauth_account_sync",
                    payments_synced_created=resumo["payments_synced_created"],
                    payments_synced_updated=resumo["payments_synced_updated"],
                    expenses_created=resumo["expenses_created"],
                    categories_created=resumo["categories_created"],
                    payments_count=resumo["payments_count"],
                    charges_count=resumo["charges_count"],
                    movements_count=resumo["movements_count"],
                    balance_found=resumo["balance_found"],
                )
                source.write_fields(
                    {
                        "payments": db.get("payments", []),
                        "expenses": db.get("expenses", []),
                        "categories": db.get("categories", []),
                        "mercado_pago_oauth_data": db.get("mercado_pago_oauth_data", {}),
                        "mercado_pago_status": status,
                    }
                )
            except Exception as e:
                return "erro", f"Falha ao gravar dados de volta ({source.describe()}): {e}"

            new_refresh = token_info.get("refresh_token")
            if new_refresh and bool(cfg.get("persistir_refresh_token_em_config", False)):
                try:
                    cfg["mercado_pago_oauth_refresh_token"] = new_refresh
                    with open(args.config, "w", encoding="utf-8") as f:
                        json.dump(cfg, f, ensure_ascii=False, indent=2)
                except Exception:
                    log("aviso: não foi possível persistir novo refresh_token no arquivo de config")

            linhas = []

        linhas.extend(
            [
                f"Fonte: {source.describe()} | Conta: {conta_email}",
                f"Pagamentos consultados/sincronizados: {resumo['payments_count']} (criadas={resumo['payments_synced_created']}, atualizadas={resumo['payments_synced_updated']})",
                f"Cobranças consultadas: {resumo['charges_count']} | Movimentações consultadas: {resumo['movements_count']}",
                f"Saldo consultado: {'sim' if resumo['balance_found'] else 'não'}",
                f"Despesas geradas (modelo prático): {resumo['expenses_created']} (categorias novas: {resumo['categories_created']})",
            ]
        )

        if token_info.get("scope"):
            linhas.append(f"Escopo OAuth: {token_info.get('scope')}")

        msg = "\n".join(linhas)
        log(
            f"fonte={source.describe()} conta={conta_email} dias={dias} "
            f"payments={resumo['payments_count']} charges={resumo['charges_count']} "
            f"movements={resumo['movements_count']} expenses={resumo['expenses_created']}"
        )
        print("\n✅ " + msg)

        houve_dado = (
            resumo["payments_synced_created"]
            + resumo["payments_synced_updated"]
            + resumo["expenses_created"]
            + resumo["payments_count"]
            + resumo["charges_count"]
            + resumo["movements_count"]
        ) > 0
        return ("ok" if houve_dado else "sem_novidades"), msg


def run(args):
    return MercadoPagoOAuthAccountAgent().run(args)


def main():
    ap = argparse.ArgumentParser(
        description="Sincroniza a conta Mercado Pago via OAuth (pagamentos/cobranças/saldo/movimentações) para o painel web."
    )
    ap.add_argument("--config", default="mp_oauth_account_config.json", help="Config (veja mp_oauth_account_config.example.json)")
    ap.add_argument("--dias", type=int, default=None, help="Janela de dias para consultas históricas (padrão: 30 ou janela_dias do config)")
    ap.add_argument("--authorization-code", dest="authorization_code", default=None, help="Authorization code OAuth (fluxo inicial)")
    ap.add_argument("--refresh-token", dest="refresh_token", default=None, help="Refresh token OAuth (sobrescreve config)")
    ap.add_argument("--access-token", dest="access_token", default=None, help="Access token direto (prioridade máxima)")
    ap.add_argument("--firebase-service-account", dest="firebase_service_account", default=None, help="Sobrescreve firebase_service_account do config")
    ap.add_argument("--db-json", dest="db_json", default=None, help="Sobrescreve db_json do config")
    ap.add_argument("--dry-run", dest="dry_run", action="store_true", help="Mostra o que faria sem gravar")
    args = ap.parse_args()

    try:
        resultado, _msg = run(args)
    except Exception:
        print("\n❌ ERRO no agente OAuth de conta Mercado Pago:")
        traceback.print_exc()
        log(f"ERRO: {traceback.format_exc()}")
        sys.exit(1)

    sys.exit(0 if resultado in ("ok", "sem_novidades") else 1)


if __name__ == "__main__":
    main()
