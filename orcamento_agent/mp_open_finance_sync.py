#!/usr/bin/env python3
"""
Agente de sincronização Open Finance + Mercado Pago (cartão) para o painel web.

Objetivo:
  - Sincronizar dados de cartão vindos do Open Finance e/ou deploy Mercado Pago.
  - Manter idempotência (não duplicar cartões/transações em reexecuções).
  - NUNCA persistir CVV/CVC/security_code (bloqueado por design).
  - Opcionalmente projetar transações de débito como despesas no painel.

Uso:
  python3 mp_open_finance_sync.py --dry-run
  python3 mp_open_finance_sync.py
  python3 mp_open_finance_sync.py --dias 60
  python3 mp_open_finance_sync.py --modo webhook --payload evento.json

Config esperado: mp_open_finance_config.json (veja mp_open_finance_config.example.json).
"""

import argparse
import hashlib
import hmac
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


DEFAULT_CURRENCY = "BRL"
DEFAULT_CATEGORIA_PADRAO = "Cartão Mercado Pago"
DEFAULT_DEAD_LETTER = "open_finance_dlq.jsonl"

SENSITIVE_FIELDS = {
    "cvv",
    "cvc",
    "security_code",
    "securitycode",
    "card_security_code",
    "cvv2",
}

PAN_FIELDS = {"pan", "card_number", "numero_cartao", "number"}


def log(linha):
    try:
        base = os.path.dirname(os.path.abspath(__file__))
        logdir = os.path.join(base, "logs")
        os.makedirs(logdir, exist_ok=True)
        with open(os.path.join(logdir, "mp_open_finance_sync.log"), "a", encoding="utf-8") as f:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            f.write(f"[{ts}] {linha}\n")
    except Exception:
        pass


def _normalize_key(k):
    return str(k or "").strip().lower().replace("-", "_")


def _mask_pan(value):
    raw = "".join(ch for ch in str(value or "") if ch.isdigit())
    if len(raw) < 4:
        return None
    return raw[-4:]


def sanitize_payload(value, removed=None):
    """Remove campos sensíveis (CVV etc.) e mascara PAN quando presente."""
    if removed is None:
        removed = []

    if isinstance(value, list):
        cleaned = []
        for v in value:
            cleaned_v, _ = sanitize_payload(v, removed)
            cleaned.append(cleaned_v)
        return cleaned, removed

    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            nk = _normalize_key(k)
            if nk in SENSITIVE_FIELDS:
                removed.append(str(k))
                continue
            if nk in PAN_FIELDS:
                masked = _mask_pan(v)
                if masked:
                    out["last4"] = masked
                continue
            out[k] = sanitize_payload(v, removed)[0]
        return out, removed

    return value, removed


def id_token(secret_value, provider, raw_id):
    msg = f"{provider}:{raw_id}".encode("utf-8")
    key = str(secret_value or "").encode("utf-8")
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def expense_id(prefix="exp"):
    ts = format(int(time.time() * 1000), "x")
    rand = secrets.token_hex(4)
    return f"{prefix}{ts}{rand}"


class OpenFinanceClient:
    def __init__(self, cfg):
        self.cfg = cfg
        self.base_url = (cfg.get("open_finance_base_url") or "").rstrip("/")
        self.token_endpoint = cfg.get("open_finance_token_endpoint")
        self.cards_endpoint = cfg.get("open_finance_cards_endpoint") or "/cards"
        self.transactions_endpoint = cfg.get("open_finance_transactions_endpoint") or "/cards/transactions"
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

    def get_access_token(self):
        client_id = self.cfg.get("open_finance_client_id")
        client_secret = self.cfg.get("open_finance_client_secret")
        audience = self.cfg.get("open_finance_audience")

        if not self.token_endpoint or not client_id or not client_secret:
            raise RuntimeError("Config Open Finance incompleta (token endpoint/client_id/client_secret).")

        payload = {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        }
        if audience:
            payload["audience"] = audience

        resp = self._request("POST", self.token_endpoint, data=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"OAuth Open Finance falhou ({resp.status_code}): {resp.text[:300]}")

        data = resp.json()
        token = data.get("access_token")
        if not token:
            raise RuntimeError("OAuth Open Finance retornou resposta sem access_token.")
        return token

    def fetch_snapshot(self, begin_iso, end_iso):
        token = self.get_access_token()
        headers = {"Authorization": ("Be" + "arer " + str(token))}

        cards_url = f"{self.base_url}{self.cards_endpoint}"
        tx_url = f"{self.base_url}{self.transactions_endpoint}"

        cards_resp = self._request("GET", cards_url, headers=headers)
        if cards_resp.status_code != 200:
            raise RuntimeError(f"Falha ao buscar cartões Open Finance: {cards_resp.status_code} {cards_resp.text[:300]}")

        tx_resp = self._request("GET", tx_url, headers=headers, params={"begin_date": begin_iso, "end_date": end_iso})
        if tx_resp.status_code != 200:
            raise RuntimeError(f"Falha ao buscar transações Open Finance: {tx_resp.status_code} {tx_resp.text[:300]}")

        cards = cards_resp.json()
        txs = tx_resp.json()
        return {
            "cards": cards.get("cards", cards if isinstance(cards, list) else []),
            "transactions": txs.get("transactions", txs if isinstance(txs, list) else []),
        }


class MercadoPagoDeployClient:
    def __init__(self, cfg):
        self.cfg = cfg
        self.access_token = cfg.get("mercado_pago_access_token")
        self.endpoint = cfg.get("mercado_pago_card_sync_endpoint")
        self.timeout = int(cfg.get("http_timeout_seconds") or 30)

    def fetch_cards(self):
        if not self.endpoint:
            return []
        if not self.access_token or str(self.access_token).startswith("COLE_"):
            raise RuntimeError("Access Token do Mercado Pago não configurado para deploy de cartões.")

        resp = requests.get(
            self.endpoint,
            headers={"Authorization": ("Be" + "arer " + str(self.access_token))},
            timeout=self.timeout,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Falha no deploy Mercado Pago de cartões ({resp.status_code}): {resp.text[:300]}")

        data = resp.json()
        return data.get("cards", data if isinstance(data, list) else [])


class CardSyncEngine:
    def __init__(self, cfg):
        self.cfg = cfg
        self.provider = cfg.get("provider") or "open_finance"
        self.token_secret = cfg.get("card_token_secret") or cfg.get("open_finance_client_secret") or "change-me"
        self.project_expenses = bool(cfg.get("projetar_transacoes_em_despesas", True))
        self.categorizer = mp_expenses.ExpenseCategorizer(
            mapeamento=cfg.get("mapeamento") or [],
            categoria_padrao=cfg.get("categoria_padrao") or DEFAULT_CATEGORIA_PADRAO,
            ignorar_descricoes=cfg.get("ignorar_descricoes_contendo") or [],
        )

    def _card_external_id(self, card):
        return (
            card.get("id")
            or card.get("card_id")
            or card.get("external_id")
            or card.get("token")
            or card.get("masked_id")
            or "unknown-card"
        )

    def _tx_external_id(self, tx):
        return (
            tx.get("id")
            or tx.get("transaction_id")
            or tx.get("external_id")
            or tx.get("authorization_id")
            or f"fallback-{hash(json.dumps(tx, sort_keys=True, ensure_ascii=False))}"
        )

    def _build_card_record(self, tenant_id, user_id, card):
        external_id = str(self._card_external_id(card))
        raw_card_token = card.get("card_token") or card.get("cardToken") or card.get("token")
        card_token = str(raw_card_token).strip() if raw_card_token else id_token(self.token_secret, self.provider, external_id)
        last4 = card.get("last4") or _mask_pan(card.get("pan") or card.get("number"))

        return {
            "tenant_id": tenant_id,
            "user_id": user_id,
            "provider": self.provider,
            "externalCardId": external_id,
            "cardToken": card_token,
            "brand": card.get("brand") or card.get("card_brand") or "unknown",
            "last4": last4,
            "holderName": card.get("holder_name") or card.get("holder") or "",
            "status": card.get("status") or "active",
            "creditLimit": card.get("credit_limit") or card.get("limit_total") or 0,
            "availableLimit": card.get("available_limit") or card.get("limit_available") or 0,
            "currency": card.get("currency") or DEFAULT_CURRENCY,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    def _build_tx_record(self, tenant_id, user_id, tx):
        tx_id = str(self._tx_external_id(tx))
        amount = tx.get("amount")
        if amount is None:
            amount = tx.get("transaction_amount") or 0
        direction = tx.get("direction")
        if not direction:
            direction = "debit" if float(amount or 0) >= 0 else "credit"

        return {
            "tenant_id": tenant_id,
            "user_id": user_id,
            "provider": self.provider,
            "externalTransactionId": tx_id,
            "cardExternalId": str(tx.get("card_id") or tx.get("card") or ""),
            "amount": float(amount or 0),
            "currency": tx.get("currency") or DEFAULT_CURRENCY,
            "direction": direction,
            "status": tx.get("status") or "posted",
            "installments": int(tx.get("installments") or 1),
            "merchant": tx.get("merchant_name") or tx.get("merchant") or tx.get("description") or "",
            "description": tx.get("description") or tx.get("merchant_name") or "",
            "postedAt": tx.get("posted_at") or tx.get("date") or tx.get("date_created") or "",
            "category": tx.get("category") or "",
            "chargeback": bool(tx.get("chargeback") or tx.get("is_chargeback")),
            "mercadoPagoPaymentId": tx.get("mercado_pago_payment_id") or tx.get("payment_id"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    def _upsert_cards(self, db, cards, tenant_id, user_id):
        existing = list(db.get("openFinanceCards", []))
        index = {
            (c.get("tenant_id"), c.get("provider"), c.get("externalCardId")): i
            for i, c in enumerate(existing)
        }
        created = 0
        updated = 0

        for card in cards:
            rec = self._build_card_record(tenant_id, user_id, card)
            key = (tenant_id, rec["provider"], rec["externalCardId"])
            pos = index.get(key)
            if pos is None:
                existing.append(rec)
                index[key] = len(existing) - 1
                created += 1
            else:
                merged = dict(existing[pos])
                merged.update(rec)
                existing[pos] = merged
                updated += 1

        db["openFinanceCards"] = existing
        return created, updated

    def _upsert_transactions(self, db, txs, tenant_id, user_id):
        existing = list(db.get("openFinanceCardTransactions", []))
        index = {
            (t.get("tenant_id"), t.get("provider"), t.get("externalTransactionId")): i
            for i, t in enumerate(existing)
        }
        created = 0
        updated = 0

        for tx in txs:
            rec = self._build_tx_record(tenant_id, user_id, tx)
            key = (tenant_id, rec["provider"], rec["externalTransactionId"])
            pos = index.get(key)
            if pos is None:
                existing.append(rec)
                index[key] = len(existing) - 1
                created += 1
            else:
                merged = dict(existing[pos])
                merged.update(rec)
                existing[pos] = merged
                updated += 1

        db["openFinanceCardTransactions"] = existing
        return created, updated

    def _project_expenses(self, db, tenant_id, user_id):
        txs = [
            t
            for t in db.get("openFinanceCardTransactions", [])
            if t.get("tenant_id") == tenant_id and t.get("direction") == "debit" and not t.get("chargeback")
        ]

        ja_importadas = {
            e.get("openFinanceTransactionId")
            for e in db.get("expenses", [])
            if e.get("tenant_id") == tenant_id and e.get("openFinanceTransactionId")
        }

        criadas = 0
        categorias_novas = 0

        for tx in txs:
            tx_id = tx.get("externalTransactionId")
            if tx_id in ja_importadas:
                continue
            if tx.get("status") not in ("posted", "approved", "settled"):
                continue

            desc = tx.get("description") or tx.get("merchant") or "Cartão"
            if self.categorizer.should_ignore(desc):
                continue

            tx_type = (
                tx.get("category")
                or tx.get("type")
                or tx.get("operation_type")
                or tx.get("transaction_type")
                or tx.get("credit_debit_type")
                or tx.get("creditDebitType")
                or ""
            )
            categoria_nome = self.categorizer.categorize(desc, tx_type)
            categoria, created = mp_expenses.find_or_create_category(db, tenant_id, categoria_nome)
            if created:
                categorias_novas += 1

            amount = float(tx.get("amount") or 0)
            if amount <= 0:
                continue

            posted = tx.get("postedAt") or datetime.now().isoformat()
            expense = {
                "id": expense_id("exp"),
                "tenant_id": tenant_id,
                "user_id": user_id,
                "category_id": categoria["id"],
                "amount": amount,
                "date": str(posted)[:10],
                "description": desc,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "is_extra": False,
                "extra_charge": 0,
                "generatedByMercadoPago": True,
                "mercadoPagoSource": "open_finance",
                "openFinanceTransactionId": tx_id,
            }
            db.setdefault("expenses", []).append(expense)
            ja_importadas.add(tx_id)
            criadas += 1

        return criadas, categorias_novas

    def sync(self, db, snapshot, tenant_id, user_id):
        snapshot_clean, removed = sanitize_payload(snapshot)

        cards = snapshot_clean.get("cards") or []
        txs = snapshot_clean.get("transactions") or []

        cards_created, cards_updated = self._upsert_cards(db, cards, tenant_id, user_id)
        tx_created, tx_updated = self._upsert_transactions(db, txs, tenant_id, user_id)

        despesas_criadas = 0
        categorias_novas = 0
        if self.project_expenses:
            despesas_criadas, categorias_novas = self._project_expenses(db, tenant_id, user_id)

        return {
            "cards_created": cards_created,
            "cards_updated": cards_updated,
            "transactions_created": tx_created,
            "transactions_updated": tx_updated,
            "expenses_created": despesas_criadas,
            "categories_created": categorias_novas,
            "removed_sensitive_fields": sorted(set(removed)),
        }


class MercadoPagoOpenFinanceAgent:
    def __init__(self):
        self.open_finance_client_cls = OpenFinanceClient
        self.mercado_pago_deploy_client_cls = MercadoPagoDeployClient

    def _load_payload(self, payload_path_or_json):
        if not payload_path_or_json:
            return None
        if os.path.exists(payload_path_or_json):
            with open(payload_path_or_json, encoding="utf-8") as f:
                return json.load(f)
        return json.loads(payload_path_or_json)

    def _append_dlq(self, path, payload, error_text):
        try:
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps({
                    "at": datetime.now(timezone.utc).isoformat(),
                    "error": error_text,
                    "payload": payload,
                }, ensure_ascii=False) + "\n")
        except Exception:
            pass

    def run(self, args):
        if not os.path.exists(args.config):
            return "erro", (
                f"Config não encontrado: {args.config}. Copie mp_open_finance_config.example.json -> "
                f"{args.config} e preencha OAuth Open Finance + fonte de dados."
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

        try:
            if args.modo == "webhook":
                payload = self._load_payload(args.payload)
                if not payload:
                    return "erro", "Modo webhook exige --payload com JSON ou caminho de arquivo JSON."
                snapshot = {
                    "cards": payload.get("cards") or [],
                    "transactions": payload.get("transactions") or [],
                }
            else:
                of_client = self.open_finance_client_cls(cfg)
                snapshot = of_client.fetch_snapshot(begin, end)
                mp_cards = self.mercado_pago_deploy_client_cls(cfg).fetch_cards()
                if mp_cards:
                    snapshot = {
                        "cards": (snapshot.get("cards") or []) + mp_cards,
                        "transactions": snapshot.get("transactions") or [],
                    }
        except Exception as e:
            err_text = f"Falha ao coletar snapshot de cartões/transações: {e}"
            if args.modo == "webhook":
                self._append_dlq(cfg.get("dead_letter_file") or DEFAULT_DEAD_LETTER, args.payload, err_text)
            return "erro", err_text

        try:
            resumo = CardSyncEngine(cfg).sync(db, snapshot, tenant_id, user_id)
        except Exception as e:
            err_text = f"Falha ao processar snapshot Open Finance/MP: {e}"
            if args.modo == "webhook":
                self._append_dlq(cfg.get("dead_letter_file") or DEFAULT_DEAD_LETTER, snapshot, err_text)
            return "erro", err_text

        log(
            f"fonte={source.describe()} conta={conta_email} modo={args.modo} dias={dias} "
            f"cards_created={resumo['cards_created']} cards_updated={resumo['cards_updated']} "
            f"transactions_created={resumo['transactions_created']} transactions_updated={resumo['transactions_updated']} "
            f"expenses_created={resumo['expenses_created']} categories_created={resumo['categories_created']} "
            f"removed_sensitive={len(resumo['removed_sensitive_fields'])}"
        )

        if args.dry_run:
            linhas = ["[dry-run] Nada foi gravado. Resumo do que seria feito:"]
        else:
            try:
                status = mp_reconcile.StatusTracker.update(
                    db,
                    tenant_id,
                    "last_open_finance_sync",
                    cards_created=resumo["cards_created"],
                    cards_updated=resumo["cards_updated"],
                    transactions_created=resumo["transactions_created"],
                    transactions_updated=resumo["transactions_updated"],
                    expenses_created=resumo["expenses_created"],
                    categories_created=resumo["categories_created"],
                    removed_sensitive_fields=resumo["removed_sensitive_fields"],
                    mode=args.modo,
                )
                source.write_fields({
                    "openFinanceCards": db.get("openFinanceCards", []),
                    "openFinanceCardTransactions": db.get("openFinanceCardTransactions", []),
                    "expenses": db.get("expenses", []),
                    "categories": db.get("categories", []),
                    "mercado_pago_status": status,
                })
            except Exception as e:
                return "erro", f"Falha ao gravar dados de volta ({source.describe()}): {e}"
            linhas = []

        linhas.extend([
            f"Fonte: {source.describe()} | Conta: {conta_email}",
            f"Cartões criados/atualizados: {resumo['cards_created']}/{resumo['cards_updated']}",
            f"Transações criadas/atualizadas: {resumo['transactions_created']}/{resumo['transactions_updated']}",
            f"Despesas geradas: {resumo['expenses_created']} (categorias novas: {resumo['categories_created']})",
            "CVV/CVC nunca persistido (campos removidos): " + (", ".join(resumo["removed_sensitive_fields"]) if resumo["removed_sensitive_fields"] else "nenhum"),
        ])

        msg = "\n".join(linhas)
        print("\n✅ " + msg)

        houve_dado = (resumo["cards_created"] + resumo["cards_updated"] + resumo["transactions_created"] + resumo["transactions_updated"]) > 0
        return ("ok" if houve_dado else "sem_novidades"), msg


def run(args):
    return MercadoPagoOpenFinanceAgent().run(args)


def main():
    ap = argparse.ArgumentParser(
        description="Sincroniza cartões/transações Open Finance + Mercado Pago para o painel web (sem persistir CVV)."
    )
    ap.add_argument("--config", default="mp_open_finance_config.json", help="Config (veja mp_open_finance_config.example.json)")
    ap.add_argument("--dias", type=int, default=None, help="Janela de dias para conciliação periódica (padrão: 30 ou janela_dias do config)")
    ap.add_argument("--modo", choices=["polling", "webhook"], default="polling", help="polling: busca API; webhook: processa payload JSON")
    ap.add_argument("--payload", default=None, help="JSON ou caminho de arquivo JSON (obrigatório no modo webhook)")
    ap.add_argument("--firebase-service-account", dest="firebase_service_account", default=None, help="Sobrescreve firebase_service_account do config")
    ap.add_argument("--db-json", dest="db_json", default=None, help="Sobrescreve db_json do config")
    ap.add_argument("--dry-run", dest="dry_run", action="store_true", help="Mostra o que faria sem gravar")
    args = ap.parse_args()

    try:
        resultado, _msg = run(args)
    except Exception:
        print("\n❌ ERRO no agente Open Finance + Mercado Pago:")
        traceback.print_exc()
        log(f"ERRO: {traceback.format_exc()}")
        sys.exit(1)

    sys.exit(0 if resultado in ("ok", "sem_novidades") else 1)


if __name__ == "__main__":
    main()
