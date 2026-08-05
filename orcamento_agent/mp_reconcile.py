#!/usr/bin/env python3
"""
Agente de reconciliação Mercado Pago <-> painel web (dashboard.html).

O que faz:
  Busca pagamentos aprovados de verdade no Mercado Pago (API /v1/payments/search,
  mesma conta associada à chave Pix usada no modal de pagamento do painel — ver
  PIX_MERCHANT em js/dashboard.js e js/pix.js) e cruza por valor + data com o
  histórico de pagamentos que o próprio app já gravou (Firestore, se configurado,
  com fallback num db.json local — mesmo "banco" descrito no README.md). Qualquer
  pagamento que o usuário só tinha CONFIRMADO MANUALMENTE (comprovante que a IA
  local, js/receipt-ai.js, não conseguiu validar automaticamente) passa a ficar
  marcado como "verificado pelo Mercado Pago" quando encontra uma correspondência
  clara — sem precisar reabrir o app.

Por que existe / limitações (leia antes de usar):
  O site (fintech_app.github.io) é 100% estático — o Access Token do Mercado Pago
  NUNCA pode ir para o navegador/site público. Por isso esta reconciliação roda só
  localmente (manual ou agendada), no mesmo espírito de mp_sync.py (que já faz algo
  parecido para a planilha de orçamento do casamento). Isso NÃO é uma confirmação
  bancária em tempo real via webhook — é um cruzamento best-effort por valor e
  janela de datas (o Pix pago pelo usuário não carrega o txid do app até o
  Mercado Pago, então não há uma chave 100% exata para casar as duas pontas).
  Quando duas ou mais transações do Mercado Pago batem com o mesmo valor na mesma
  janela, o pagamento fica marcado como "ambíguo" e não é confirmado automaticamente
  — fica para revisão manual, exatamente como já acontece quando a IA de OCR do
  comprovante não consegue confirmar (ver "Importante sobre o Pix" no README.md).

Uso:
  python3 mp_reconcile.py                                  (últimos 30 dias, grava)
  python3 mp_reconcile.py --dias 60
  python3 mp_reconcile.py --dry-run                        (mostra o que faria, não grava nada)
  python3 mp_reconcile.py --config outro_config.json
  python3 mp_reconcile.py --firebase-service-account chave.json
  python3 mp_reconcile.py --db-json copia_local_do_banco.json

Fonte dos dados do app (configure UMA das duas em mp_reconcile_config.json — veja
mp_reconcile_config.example.json):
  - "firebase_service_account": caminho de uma chave de conta de serviço do
    Firebase (Console do Firebase -> Configurações do projeto -> Contas de
    serviço -> Gerar nova chave privada). Lê/grava direto no MESMO documento
    Firestore (`fintech_saas/db_v1`) usado pelo painel web -- recomendado.
  - "db_json": caminho de uma cópia local do banco no formato do db.json/
    localStorage -- útil sem Firebase configurado, mas não reflete gravações
    feitas só no localStorage de um navegador (não há como este script alcançar
    o localStorage de outra máquina).

⚠️ Segurança: os mesmos cuidados de orcamento_agent/config.json valem aqui — tanto
o Access Token do Mercado Pago quanto a chave de conta de serviço do Firebase são
segredos que dão acesso real à conta. Nunca versione mp_reconcile_config.json nem
a chave do Firebase (ver .gitignore). Se vazarem, revogue-os imediatamente.

Requer: pip install requests openpyxl --break-system-packages (mesmas dependências
de mp_sync.py, reaproveitado aqui) e, só se for usar o Firestore como fonte,
firebase-admin (pip install firebase-admin --break-system-packages).
"""
import argparse
import json
import os
import sys
import traceback
from datetime import datetime, timedelta, timezone

import mp_sync  # reaproveita fetch_mp_payments() -- mesma busca já usada pela planilha


# ---------- utilidades de data ----------

def to_utc_date(iso_str):
    """Converte uma string ISO 8601 (com 'Z' ou offset numérico, como as geradas
    por Date.toISOString() no navegador ou pela API do Mercado Pago) num
    datetime "naive" em UTC, pronto para comparar. Retorna None se não der
    para interpretar (nunca lança exceção -- comparação heurística, não crítica)."""
    if not iso_str:
        return None
    s = str(iso_str).strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        try:
            dt = datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def day_range(dias):
    """Janela [agora - dias, agora] no formato exigido pela API do Mercado Pago
    (mesmo formato usado em mp_sync.month_bounds)."""
    fim = datetime.now()
    inicio = fim - timedelta(days=dias)
    fmt = "%Y-%m-%dT%H:%M:%S.000-03:00"
    return inicio.strftime(fmt), fim.strftime(fmt)


# ---------- log (best-effort, nunca derruba o script) ----------

def log(linha):
    try:
        base = os.path.dirname(os.path.abspath(__file__))
        logdir = os.path.join(base, "logs")
        os.makedirs(logdir, exist_ok=True)
        with open(os.path.join(logdir, "mp_reconcile.log"), "a", encoding="utf-8") as f:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            f.write(f"[{ts}] {linha}\n")
    except Exception:
        pass


# ---------- fontes de dados do app (Firestore ou db.json local) ----------

class FirestoreSource:
    """Lê/grava direto no mesmo documento Firestore usado pelo painel web
    (js/db.js: colecao `fintech_saas`, documento `db_v1`). A gravação usa
    update() em vez de set() no documento inteiro -- só os campos passados a
    write_fields() são tocados, para não arriscar sobrescrever uma gravação
    concorrente feita pelo navegador em outro campo enquanto este script
    roda."""

    COLLECTION = "fintech_saas"
    DOC_ID = "db_v1"

    def __init__(self, service_account_path):
        try:
            import firebase_admin
            from firebase_admin import credentials, firestore
        except ImportError:
            raise RuntimeError(
                "Falta o pacote 'firebase-admin'. Rode: pip install firebase-admin --break-system-packages"
            )
        if not firebase_admin._apps:
            cred = credentials.Certificate(service_account_path)
            firebase_admin.initialize_app(cred)
        self._client = firestore.client()
        self._ref = self._client.collection(self.COLLECTION).document(self.DOC_ID)

    def read(self):
        snap = self._ref.get()
        if not snap.exists:
            raise RuntimeError(
                f"Documento {self.COLLECTION}/{self.DOC_ID} ainda não existe no Firestore "
                "(nenhum dado foi sincronizado pelo app ainda)."
            )
        return snap.to_dict()

    def write_fields(self, fields):
        """Atualiza só os campos passados (ex.: {"payments": [...]}), sem
        tocar no resto do documento -- ver docstring da classe."""
        self._ref.update(fields)

    def write_payments(self, payments):
        self.write_fields({"payments": payments})

    def describe(self):
        return f"Firestore ({self.COLLECTION}/{self.DOC_ID})"


class LocalJsonSource:
    """Fonte alternativa sem Firebase: lê/grava uma cópia local do banco no
    mesmo formato do db.json/localStorage. Regrava o arquivo inteiro (sem
    concorrência a considerar, é um arquivo local)."""

    def __init__(self, path):
        self.path = path

    def read(self):
        if not os.path.exists(self.path):
            raise FileNotFoundError(f"Arquivo não encontrado: {self.path}")
        with open(self.path, encoding="utf-8") as f:
            return json.load(f)

    def write_fields(self, fields):
        db = self.read()
        db.update(fields)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=2)

    def write_payments(self, payments):
        self.write_fields({"payments": payments})

    def describe(self):
        return f"db.json local ({self.path})"


def build_source(cfg, args):
    sa_path = args.firebase_service_account or cfg.get("firebase_service_account")
    if sa_path:
        if not os.path.exists(sa_path):
            raise RuntimeError(f"Chave de conta de serviço do Firebase não encontrada: {sa_path}")
        return FirestoreSource(sa_path)

    db_json = args.db_json or cfg.get("db_json")
    if db_json:
        return LocalJsonSource(db_json)

    raise RuntimeError(
        "Nenhuma fonte de dados configurada. Defina \"firebase_service_account\" (recomendado -- "
        "mesmo banco do painel web) ou \"db_json\" (cópia local) em mp_reconcile_config.json -- "
        "veja mp_reconcile_config.example.json."
    )


# ---------- reconciliação ----------

def reconcile_payments(app_payments, mp_payments, window_days=2, tolerance=0.01):
    """Cruza os pagamentos do app com os pagamentos aprovados do Mercado Pago.

    Não muta as listas recebidas -- devolve (payments_atualizados, resumo).
    Regras:
      - Pagamentos já verificados (por IA ou por uma execução anterior deste
        script) são deixados exatamente como estão.
      - Só pagamentos aprovados no Mercado Pago (status == "approved") entram
        na disputa.
      - Correspondência = mesmo valor (tolerância de centavos) + data dentro
        de `window_days` dias uma da outra.
      - Exatamente uma correspondência -> marca verifiedByMercadoPago=True e
        guarda o id do pagamento no Mercado Pago (mercadoPagoPaymentId).
      - Duas ou mais correspondências possíveis (mesmo valor, mesma janela) ->
        fica "ambíguo", não marca nada automaticamente (evita risco de
        confirmar o pagamento errado).
      - Nenhuma correspondência -> segue pendente (tentaremos de novo na
        próxima execução, quando o pagamento pode já ter sido processado
        pelo Mercado Pago).
      - Cada transação do Mercado Pago só pode ser usada para confirmar UM
        pagamento do app (evita que um único Pix real "confirme" dois
        lançamentos diferentes).
    """
    approved = [
        p for p in mp_payments
        if p.get("status") == "approved" and to_utc_date(p.get("date_approved") or p.get("date_created")) is not None
    ]

    used_mp_ids = {
        p.get("mercadoPagoPaymentId")
        for p in app_payments
        if p.get("verifiedByMercadoPago") and p.get("mercadoPagoPaymentId") is not None
    }

    now_iso = datetime.now(timezone.utc).isoformat()
    resumo = {"verificados": [], "ambiguos": [], "sem_correspondencia": [], "ja_verificados": 0, "ignorados": 0}
    updated = []

    for payment in app_payments:
        p = dict(payment)

        if p.get("verifiedByAI") or p.get("verifiedByMercadoPago"):
            resumo["ja_verificados"] += 1
            updated.append(p)
            continue

        amount = p.get("amount")
        pay_date = to_utc_date(p.get("date"))
        if amount is None or pay_date is None:
            resumo["ignorados"] += 1
            updated.append(p)
            continue

        candidatos = []
        for mp in approved:
            mp_id = mp.get("id")
            if mp_id in used_mp_ids:
                continue
            try:
                mp_amount = float(mp.get("transaction_amount", 0))
            except (TypeError, ValueError):
                continue
            if abs(mp_amount - float(amount)) > tolerance:
                continue
            mp_date = to_utc_date(mp.get("date_approved") or mp.get("date_created"))
            if mp_date is None or abs((mp_date - pay_date).days) > window_days:
                continue
            candidatos.append(mp)

        p["mercadoPagoCheckedAt"] = now_iso

        if len(candidatos) == 1:
            match = candidatos[0]
            p["verifiedByMercadoPago"] = True
            p["mercadoPagoPaymentId"] = match.get("id")
            used_mp_ids.add(match.get("id"))
            resumo["verificados"].append(
                {"payment_id": p.get("id"), "mp_payment_id": match.get("id"), "amount": amount}
            )
        elif len(candidatos) > 1:
            resumo["ambiguos"].append(
                {"payment_id": p.get("id"), "amount": amount, "candidatos": [c.get("id") for c in candidatos]}
            )
        else:
            resumo["sem_correspondencia"].append({"payment_id": p.get("id"), "amount": amount})

        updated.append(p)

    return updated, resumo


def run(args):
    """Executa a reconciliação e devolve (resultado, mensagem), no mesmo
    estilo de mp_sync.run() -- para uso programático e por agendamento."""
    if not os.path.exists(args.config):
        return "erro", (
            f"Config não encontrado: {args.config}. Copie mp_reconcile_config.example.json -> "
            f"{args.config} e preencha o token + a fonte de dados (firebase_service_account ou db_json)."
        )

    with open(args.config, encoding="utf-8") as f:
        cfg = json.load(f)

    token = cfg.get("mercado_pago_access_token")
    if not token or str(token).startswith("COLE_"):
        return "erro", "Access token do Mercado Pago não configurado em mp_reconcile_config.json."

    try:
        source = build_source(cfg, args)
    except Exception as e:
        return "erro", str(e)

    dias = args.dias or cfg.get("janela_dias") or 30
    begin, end = day_range(dias)
    print(f"Buscando pagamentos aprovados no Mercado Pago dos últimos {dias} dia(s) ({begin} a {end})...")
    try:
        mp_payments = mp_sync.fetch_mp_payments(token, begin, end)
    except Exception as e:
        return "erro", f"Falha ao consultar o Mercado Pago: {e}"
    print(f"{len(mp_payments)} pagamento(s) encontrado(s) no Mercado Pago no período.")

    try:
        db = source.read()
    except Exception as e:
        return "erro", f"Falha ao ler os dados do app ({source.describe()}): {e}"

    app_payments = db.get("payments", [])
    updated, resumo = reconcile_payments(app_payments, mp_payments, window_days=args.janela_correspondencia)

    n_verificados = len(resumo["verificados"])
    n_ambiguos = len(resumo["ambiguos"])
    n_sem = len(resumo["sem_correspondencia"])

    log(
        f"fonte={source.describe()} dias={dias} pagamentos_app={len(app_payments)} "
        f"mp_encontrados={len(mp_payments)} verificados={n_verificados} ambiguos={n_ambiguos} "
        f"sem_correspondencia={n_sem} ja_verificados={resumo['ja_verificados']}"
    )

    if args.dry_run:
        print("\n[dry-run] Nada foi gravado. Resumo do que seria feito:")
    else:
        try:
            source.write_payments(updated)
        except Exception as e:
            return "erro", f"Falha ao gravar os dados de volta ({source.describe()}): {e}"

    linhas = [
        f"Fonte: {source.describe()}",
        f"{n_verificados} pagamento(s) verificado(s) automaticamente via Mercado Pago.",
    ]
    for v in resumo["verificados"]:
        linhas.append(f"  - pagamento #{v['payment_id']} (R$ {v['amount']:.2f}) <- Mercado Pago #{v['mp_payment_id']}")

    if n_ambiguos:
        linhas.append(
            f"⚠️  {n_ambiguos} pagamento(s) com mais de uma correspondência possível "
            "(não marcados automaticamente — revise manualmente):"
        )
        for a in resumo["ambiguos"]:
            linhas.append(f"  - pagamento #{a['payment_id']} (R$ {a['amount']:.2f}) -> candidatos: {a['candidatos']}")

    if n_sem:
        linhas.append(
            f"{n_sem} pagamento(s) ainda sem correspondência no Mercado Pago "
            "(tentaremos de novo na próxima execução)."
        )

    msg = "\n".join(linhas)
    icon = "✅" if n_verificados else ("⚠️" if n_ambiguos else "ℹ️")
    print(f"\n{icon} {msg}")

    resultado = "ok" if n_verificados > 0 else ("ambiguo" if n_ambiguos else "sem_pendencias")
    return resultado, msg


def main():
    ap = argparse.ArgumentParser(
        description="Reconcilia pagamentos reais do Mercado Pago com o histórico de pagamentos do painel web."
    )
    ap.add_argument("--config", default="mp_reconcile_config.json", help="Caminho do config (veja mp_reconcile_config.example.json)")
    ap.add_argument("--dias", type=int, default=None, help="Quantos dias para trás buscar no Mercado Pago (padrão: 30, ou \"janela_dias\" do config)")
    ap.add_argument(
        "--janela-correspondencia", dest="janela_correspondencia", type=int, default=2,
        help="Tolerância de dias entre a data do pagamento no app e a data aprovada no Mercado Pago (padrão: 2)",
    )
    ap.add_argument("--firebase-service-account", dest="firebase_service_account", default=None, help="Sobrescreve \"firebase_service_account\" do config")
    ap.add_argument("--db-json", dest="db_json", default=None, help="Sobrescreve \"db_json\" do config (fonte alternativa sem Firebase)")
    ap.add_argument("--dry-run", dest="dry_run", action="store_true", help="Mostra o que seria alterado sem gravar nada")
    args = ap.parse_args()

    try:
        resultado, msg = run(args)
    except Exception:
        print("\n❌ ERRO ao reconciliar com o Mercado Pago:")
        traceback.print_exc()
        log(f"ERRO: {traceback.format_exc()}")
        sys.exit(1)

    sys.exit(0 if resultado in ("ok", "sem_pendencias") else (2 if resultado == "ambiguo" else 1))


if __name__ == "__main__":
    main()
