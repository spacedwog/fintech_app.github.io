#!/usr/bin/env python3
"""
Agente que gera despesas no painel web (dashboard.html) a partir de
pagamentos reais do Mercado Pago -- fecha o fluxo "🔄 Orçamento & Despesas"
alimentando a Página 2 (Registrar Despesas) automaticamente, em vez de
depender só de lançamento manual. O Previsto importado na Página 1 e o
Realizado calculado na Página 3 passam a refletir gasto de verdade, sem
digitar nada.

O que faz:
  1. Busca pagamentos aprovados no Mercado Pago (API /v1/payments/search,
     reaproveita mp_sync.fetch_mp_payments -- mesma busca já usada pela
     planilha de orçamento).
  2. Descarta o que NÃO é despesa da conta: pagamentos já reconciliados como
     cobrança recebida pelo próprio app (assinatura/despesa extra pagas por
     usuários do painel via Pix -- ver orcamento_agent/mp_reconcile.py) e,
     como reforço, qualquer descrição batendo com "ignorar_descricoes_contendo".
  3. Categoriza o restante por palavra-chave ("mapeamento" do config -- mesma
     ideia da aba Mapeamento do mp_sync.py), criando a categoria no app se
     ainda não existir; sem correspondência, usa "categoria_padrao".
  4. Grava cada pagamento como uma despesa real (Firestore ou db.json local,
     mesmo banco do painel web) -- sem cobrar taxa de despesa extra do plano
     Free (isto é importação de histórico, não uma ação em tempo real do
     usuário) e sem duplicar em execuções futuras (guarda o id do pagamento
     no Mercado Pago em cada despesa gerada).

Ordem recomendada: rode mp_reconcile.py ANTES deste script, pelo menos uma
vez, para que cobranças de assinatura/despesa extra do app já apareçam
marcadas em "payments" e sejam excluídas com precisão (ver passo 2 acima) --
sem isso, o filtro de descrição (passo 2b) ainda funciona, mas é só um
heurístico de reforço.

Uso:
  python3 mp_expenses.py --dry-run          (mostra o que geraria, sem gravar)
  python3 mp_expenses.py                    (gera de verdade, últimos 30 dias)
  python3 mp_expenses.py --dias 90
  python3 mp_expenses.py --config outro_config.json

Requer um mp_expenses_config.json (veja mp_expenses_config.example.json) com
o Access Token, "conta_email" (e-mail da conta do painel web que vai receber
as despesas) e a fonte de dados (firebase_service_account OU db_json --
mesmo esquema de orcamento_agent/mp_reconcile.py).

⚠️ Segurança: mesmos cuidados de mp_reconcile.py -- nunca versione
mp_expenses_config.json nem a chave de conta de serviço do Firebase (ver
.gitignore).

Reescrito em POO: IdGenerator (gera ids únicos), ExpenseCategorizer
(categorização por palavra-chave + filtro de descrição) e ExpenseGenerator
(gera as despesas propriamente ditas, usando o categorizador) compõem
MercadoPagoExpenseAgent, que orquestra run() de ponta a ponta. As funções
de nível de módulo usadas pelo teste (generate_expenses, run, mp_sync)
continuam existindo com a MESMA assinatura.
"""
import argparse
import json
import os
import secrets
import sys
import time
import traceback
from datetime import datetime

import mp_sync  # fetch_mp_payments, normalize
import mp_reconcile  # build_source, day_range, FirestoreSource/LocalJsonSource
import transaction_classifier_agent
import mp_expense_verifier_agent

DEFAULT_IGNORAR_DESCRICOES = ["despesa extra", "assinatura", "fintech spacecworp"]
DEFAULT_CATEGORIA_PADRAO = "Mercado Pago"
DEFAULT_CATEGORIA_ORCAMENTO = "Orçamento"


def log(linha):
    try:
        base = os.path.dirname(os.path.abspath(__file__))
        logdir = os.path.join(base, "logs")
        os.makedirs(logdir, exist_ok=True)
        with open(os.path.join(logdir, "mp_expenses.log"), "a", encoding="utf-8") as f:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            f.write(f"[{ts}] {linha}\n")
    except Exception:
        pass


class IdGenerator:
    """Ids únicos (string) no mesmo espírito do nextId() de js/db.js -- não
    precisam bater byte a byte com o formato do navegador, só ser
    praticamente únicos (timestamp + sufixo aleatório)."""

    @staticmethod
    def generate(prefix):
        ts = format(int(time.time() * 1000), "x")
        rand = secrets.token_hex(4)
        return f"{prefix}{ts}{rand}"


def gen_id(prefix):
    return IdGenerator.generate(prefix)


def find_user_by_email(db, email):
    email_norm = str(email or "").strip().lower()
    for u in db.get("users", []):
        if str(u.get("email", "")).strip().lower() == email_norm:
            return u
    return None


class ExpenseCategorizer:
    """Decide a categoria (por palavra-chave) e se um pagamento deve ser
    ignorado (filtro de descrição) -- lógica pequena, mas separada da
    geração de despesas em si (ExpenseGenerator) para poder ser testada/
    reaproveitada isoladamente."""

    def __init__(
        self,
        mapeamento=None,
        categoria_padrao=None,
        ignorar_descricoes=None,
        ai_min_confidence=transaction_classifier_agent.DEFAULT_MIN_CONFIDENCE,
    ):
        self.mapeamento = mapeamento or []
        self.categoria_padrao = categoria_padrao or DEFAULT_CATEGORIA_PADRAO
        self.ignorar_descricoes = (
            DEFAULT_IGNORAR_DESCRICOES if ignorar_descricoes is None else ignorar_descricoes
        )
        self._tipos_orcamento = ("recebimento", "beneficio", "benefício")
        self.ai_min_confidence = float(ai_min_confidence or transaction_classifier_agent.DEFAULT_MIN_CONFIDENCE)
        self.ai_classifier = transaction_classifier_agent.TransactionClassifierAgent(
            category_profiles=self._build_category_profiles(),
            default_category=self.categoria_padrao,
        )

    def _build_category_profiles(self):
        grouped = {}
        for regra in self.mapeamento:
            kw = str(regra.get("palavra_chave") or regra.get("keyword") or "").strip()
            categoria = str(regra.get("categoria") or "").strip()
            if not kw or not categoria:
                continue
            grouped.setdefault(categoria, [])
            if kw not in grouped[categoria]:
                grouped[categoria].append(kw)
        return [{"name": categoria, "keywords": keywords} for categoria, keywords in grouped.items()]

    def _classify_with_ai(self, description, expense_type=None, transaction_direction=None, transaction=None):
        tx = dict(transaction or {})
        if not tx.get("description"):
            tx["description"] = description
        if transaction_direction and not tx.get("direction"):
            tx["direction"] = transaction_direction
        if expense_type:
            tx.setdefault("type", expense_type)
            tx.setdefault("operation_type", expense_type)
            tx.setdefault("transaction_type", expense_type)
        return self.ai_classifier.classify(tx, min_confidence=self.ai_min_confidence)

    # Só a correspondência por palavra-chave -- None quando nenhuma regra bate
    # (quem chama decide o que fazer no fallback; ver categorize() abaixo).
    def match_keyword(self, description):
        desc_norm = mp_sync.normalize(description)
        for regra in self.mapeamento:
            kw = mp_sync.normalize(regra.get("palavra_chave") or regra.get("keyword") or "")
            categoria = regra.get("categoria")
            if kw and categoria and kw in desc_norm:
                return categoria
        return None

    # Correspondência por palavra-chave, com fallback pra categoria padrão.
    def _normalize_direction(self, transaction_direction):
        direction_norm = mp_sync.normalize(transaction_direction)
        if not direction_norm:
            return None
        if direction_norm in ("credit", "entrada"):
            return "credit"
        if direction_norm in ("debit", "saida"):
            return "debit"
        return None

    def _is_budget_type(self, expense_type):
        tipo_norm = mp_sync.normalize(expense_type)
        if not tipo_norm:
            return False
        for termo in self._tipos_orcamento:
            if mp_sync.normalize(termo) in tipo_norm:
                return True
        if any(t in tipo_norm for t in ("credit", "cashin", "incoming", "deposit", "entrada")):
            return True
        return False

    def classify_transaction(self, description, expense_type=None, transaction_direction=None, transaction=None):
        direction = self._normalize_direction(transaction_direction)
        if direction == "credit":
            return {"category": DEFAULT_CATEGORIA_ORCAMENTO, "classification": None, "source": "rule_credit"}
        if self._is_budget_type(expense_type):
            return {"category": DEFAULT_CATEGORIA_ORCAMENTO, "classification": None, "source": "rule_budget"}

        classification = self._classify_with_ai(
            description,
            expense_type=expense_type,
            transaction_direction=transaction_direction,
            transaction=transaction,
        )
        ai_category = (classification or {}).get("category")
        if ai_category and ai_category != self.categoria_padrao:
            return {"category": ai_category, "classification": classification, "source": "ai"}

        keyword_category = self.match_keyword(description)
        if keyword_category:
            return {"category": keyword_category, "classification": classification, "source": "keyword"}

        return {"category": self.categoria_padrao, "classification": classification, "source": "default"}

    def categorize(self, description, expense_type=None, transaction_direction=None, transaction=None):
        return self.classify_transaction(
            description,
            expense_type=expense_type,
            transaction_direction=transaction_direction,
            transaction=transaction,
        )["category"]

    def should_ignore(self, description):
        desc_norm = mp_sync.normalize(description)
        for termo in self.ignorar_descricoes:
            termo_norm = mp_sync.normalize(termo)
            if termo_norm and termo_norm in desc_norm:
                return True
        return False


def categorize(description, mapeamento):
    return ExpenseCategorizer(mapeamento=mapeamento).match_keyword(description)


def should_ignore(description, ignorar_lista):
    return ExpenseCategorizer(ignorar_descricoes=ignorar_lista).should_ignore(description)


def find_or_create_category(db, tenant_id, name):
    for c in db.get("categories", []):
        if c.get("tenant_id") == tenant_id and str(c.get("name", "")).strip().lower() == name.strip().lower():
            return c, False
    category = {"id": gen_id("cat"), "tenant_id": tenant_id, "name": name}
    db.setdefault("categories", []).append(category)
    return category, True


class ExpenseGenerator:
    """Gera despesas reais (no formato do painel web) a partir de pagamentos
    aprovados no Mercado Pago, evitando duplicatas e excluindo o que já é
    receita da conta (ver docstring do módulo).

    cross_source_window_days/cross_source_tolerance: mesma heurística
    valor+data de mp_reconcile.PaymentReconciler, aplicada aqui como reforço
    para evitar DUAS despesas para o mesmo pagamento real caso a dedup por
    mercadoPagoPaymentId sozinha não pegue algum caso (ver "Limitações" no
    LEIA-ME.md)."""

    def __init__(self, categorizer, cross_source_window_days=2, cross_source_tolerance=0.01, verifier=None):
        self.categorizer = categorizer
        self.cross_source_window_days = cross_source_window_days
        self.cross_source_tolerance = cross_source_tolerance
        self.verifier = verifier or mp_expense_verifier_agent.MercadoPagoExpenseVerifierAgent(
            classifier=self.categorizer.ai_classifier
        )

    def _is_cross_source_duplicate(self, valor, data_iso, existentes_mp):
        """True se já existe uma despesa gerada via Mercado Pago com valor e
        data próximos -- best-effort, mesmo espírito de
        mp_reconcile.PaymentReconciler (nunca lança exceção, heurística, não
        vínculo exato)."""
        alvo_date = mp_reconcile.DateParser.to_utc_date(data_iso) if data_iso else None
        if alvo_date is None:
            return False
        for e in existentes_mp:
            try:
                if abs(float(e.get("amount", 0)) - float(valor)) > self.cross_source_tolerance:
                    continue
            except (TypeError, ValueError):
                continue
            e_date = mp_reconcile.DateParser.to_utc_date(e.get("date"))
            if e_date is None:
                continue
            if abs((e_date - alvo_date).days) <= self.cross_source_window_days:
                return True
        return False

    @staticmethod
    def _infer_transaction_direction(payment):
        raw = mp_sync.normalize(" ".join([
            str(payment.get("direction") or ""),
            str(payment.get("type") or ""),
            str(payment.get("operation_type") or ""),
            str(payment.get("transaction_type") or ""),
            str(payment.get("payment_type_id") or ""),
            str(payment.get("credit_debit_type") or ""),
            str(payment.get("creditDebitType") or ""),
        ]))
        if any(t in raw for t in ("credit", "entrada", "receb", "deposit", "cashin", "incoming", "transfer_in")):
            return "credit"
        if any(t in raw for t in ("debit", "saida", "pagamento", "cashout", "outgoing", "saque", "transfer_out")):
            return "debit"
        return None

    def generate(self, db, mp_payments, tenant_id, user_id):
        """Gera despesas em `db` (mutado in-place) a partir de `mp_payments`.
        Devolve um resumo -- não grava nada, quem chama decide (permite --dry-run)."""

        # Pagamentos já reconciliados como cobrança RECEBIDA pela própria chave
        # Pix do app (assinatura/despesa extra de algum usuário do painel, ver
        # mp_reconcile.py) -- isso é receita da conta, nunca deve virar despesa.
        ja_em_payments = {
            p.get("mercadoPagoPaymentId")
            for p in db.get("payments", [])
            if p.get("tenant_id") == tenant_id and p.get("mercadoPagoPaymentId") is not None
        }
        # Pagamentos já importados como despesa em execuções anteriores deste
        # próprio script -- garante idempotência (rodar de novo não duplica).
        ja_importados = {
            e.get("mercadoPagoPaymentId")
            for e in db.get("expenses", [])
            if e.get("tenant_id") == tenant_id and e.get("mercadoPagoPaymentId") is not None
        }
        # Despesas já geradas via Mercado Pago para este tenant -- base da
        # checagem cruzada por valor+data (ver _is_cross_source_duplicate).
        # Recalculada a cada despesa nova criada nesta mesma chamada, para
        # que duas linhas do MESMO lote também não dupliquem entre si.
        existentes_mp = [
            e for e in db.get("expenses", [])
            if e.get("tenant_id") == tenant_id and e.get("generatedByMercadoPago")
        ]

        criadas = []
        ignoradas_duplicadas = 0
        ignoradas_duplicata_cruzada = 0
        ignoradas_receita = 0
        ignoradas_filtro = 0
        ignoradas_verificacao = 0
        categorias_novas = 0
        verificacoes_rejeitadas = []
        existing_transaction_ids = {
            str(item)
            for item in set(ja_em_payments).union(set(ja_importados))
            if item is not None and str(item).strip()
        }

        for p in mp_payments:
            if p.get("status") != "approved":
                continue

            mp_id = p.get("id")
            if mp_id in ja_em_payments:
                ignoradas_receita += 1
                continue
            if mp_id in ja_importados:
                ignoradas_duplicadas += 1
                continue

            desc = p.get("description") or p.get("statement_descriptor") or "(sem descrição)"
            if self.categorizer.should_ignore(desc):
                ignoradas_filtro += 1
                continue

            valor = p.get("transaction_amount", 0) or 0
            data_iso = p.get("date_approved") or p.get("date_created") or ""

            verification = self.verifier.verify_one(
                p,
                existing_transaction_ids=existing_transaction_ids,
                receipt_data=p.get("receipt_data"),
            )
            if not verification["verified"]:
                ignoradas_verificacao += 1
                verificacoes_rejeitadas.append({
                    "transaction_id": verification["transaction_id"],
                    "payment_type": verification["payment_type"],
                    "reason": verification["verification_reason"],
                })
                continue

            if self._is_cross_source_duplicate(valor, data_iso, existentes_mp):
                ignoradas_duplicata_cruzada += 1
                continue

            expense_type = (
                p.get("type")
                or p.get("operation_type")
                or p.get("transaction_type")
                or p.get("payment_type_id")
                or p.get("credit_debit_type")
                or p.get("creditDebitType")
            )
            transaction_direction = self._infer_transaction_direction(p)
            classification = self.categorizer.classify_transaction(
                desc,
                expense_type=expense_type,
                transaction_direction=transaction_direction,
                transaction=p,
            )
            categoria_nome = classification["category"]
            category, created = find_or_create_category(db, tenant_id, categoria_nome)
            if created:
                categorias_novas += 1

            data = data_iso[:10] if data_iso else datetime.now().strftime("%Y-%m-%d")

            expense = {
                "id": gen_id("exp"),
                "tenant_id": tenant_id,
                "user_id": user_id,
                "category_id": category["id"],
                "amount": valor,
                "date": data,
                "description": desc,
                "created_at": data_iso or (datetime.now().isoformat() + "Z"),
                "is_extra": False,
                "extra_charge": 0,
                # Campos extras (ignorados por js/api.js em bancos antigos, sem
                # quebrar nada): rastreiam a origem para idempotência e para o
                # selo "gerada via Mercado Pago" no painel (ver js/dashboard.js).
                "mercadoPagoPaymentId": mp_id,
                "generatedByMercadoPago": True,
                # Origem da despesa, usada no selo do painel web -- ver
                # js/dashboard.js.
                "mercadoPagoSource": "api",
                "mercadoPagoTransactionDirection": transaction_direction,
                "mercadoPagoCategorySource": classification.get("source"),
                "mercadoPagoCategoryConfidence": (
                    (classification.get("classification") or {}).get("confidence")
                ),
                "mercadoPagoTransactionType": (
                    (classification.get("classification") or {}).get("transaction_type")
                ),
                "mercadoPagoPaymentType": (
                    (classification.get("classification") or {}).get("payment_type")
                ),
                "mercadoPagoTransactionId": verification["transaction_id"],
                "mercadoPagoTransactionNumber": verification["transaction_number"],
                "mercadoPagoVerified": verification["verified"],
                "mercadoPagoVerificationReason": verification["verification_reason"],
                "mercadoPagoReceiptDetected": verification["receipt_detected"],
                "mercadoPagoReceiptConfidence": verification["receipt_confidence"],
                "mercadoPagoVerification": {
                    "transaction_id": verification["transaction_id"],
                    "transaction_number": verification["transaction_number"],
                    "payment_type": verification["payment_type"],
                    "verified": verification["verified"],
                    "verification_reason": verification["verification_reason"],
                    "receipt_detected": verification["receipt_detected"],
                    "receipt_confidence": verification["receipt_confidence"],
                },
            }
            db.setdefault("expenses", []).append(expense)
            existentes_mp.append(expense)
            criadas.append(expense)
            existing_transaction_ids.add(str(mp_id))

        return {
            "criadas": criadas,
            "categorias_novas": categorias_novas,
            "ignoradas_duplicadas": ignoradas_duplicadas,
            "ignoradas_duplicata_cruzada": ignoradas_duplicata_cruzada,
            "ignoradas_receita": ignoradas_receita,
            "ignoradas_filtro": ignoradas_filtro,
            "ignoradas_verificacao": ignoradas_verificacao,
            "verificacoes_rejeitadas": verificacoes_rejeitadas,
        }


def generate_expenses(db, mp_payments, tenant_id, user_id, cfg):
    categorizer = ExpenseCategorizer(
        mapeamento=cfg.get("mapeamento") or [],
        categoria_padrao=cfg.get("categoria_padrao") or DEFAULT_CATEGORIA_PADRAO,
        ignorar_descricoes=cfg.get("ignorar_descricoes_contendo"),
    )
    verifier = mp_expense_verifier_agent.MercadoPagoExpenseVerifierAgent(
        classifier=categorizer.ai_classifier
    )
    return ExpenseGenerator(categorizer, verifier=verifier).generate(db, mp_payments, tenant_id, user_id)


class MercadoPagoExpenseAgent:
    def run(self, args):
        """Executa a geração de despesas e devolve (resultado, mensagem), no
        mesmo estilo de mp_sync.run()/mp_reconcile.run()."""
        if not os.path.exists(args.config):
            return "erro", (
                f"Config não encontrado: {args.config}. Copie mp_expenses_config.example.json -> "
                f"{args.config} e preencha o token, \"conta_email\" e a fonte de dados."
            )

        with open(args.config, encoding="utf-8") as f:
            cfg = json.load(f)

        token = cfg.get("mercado_pago_access_token")
        if not token or str(token).startswith("COLE_"):
            return "erro", "Access token do Mercado Pago não configurado em mp_expenses_config.json."

        conta_email = cfg.get("conta_email")
        if not conta_email:
            return "erro", (
                "Informe \"conta_email\" no config -- o e-mail da conta do painel web que vai "
                "receber as despesas geradas."
            )

        try:
            source = mp_reconcile.build_source(cfg, args)
        except Exception as e:
            return "erro", str(e)

        dias = args.dias or cfg.get("janela_dias") or 30
        begin, end = mp_reconcile.day_range(dias)
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

        user = find_user_by_email(db, conta_email)
        if not user:
            return "erro", f"Nenhum usuário com o e-mail '{conta_email}' encontrado em {source.describe()}."
        tenant_id = user.get("tenant_id")
        user_id = user.get("id")

        resultado = generate_expenses(db, mp_payments, tenant_id, user_id, cfg)
        n_criadas = len(resultado["criadas"])

        log(
            f"fonte={source.describe()} conta={conta_email} dias={dias} mp_encontrados={len(mp_payments)} "
            f"despesas_criadas={n_criadas} categorias_novas={resultado['categorias_novas']} "
            f"ignoradas_receita={resultado['ignoradas_receita']} ignoradas_duplicadas={resultado['ignoradas_duplicadas']} "
            f"ignoradas_duplicata_cruzada={resultado['ignoradas_duplicata_cruzada']} "
            f"ignoradas_filtro={resultado['ignoradas_filtro']}"
        )

        if args.dry_run:
            print("\n[dry-run] Nada foi gravado. Resumo do que seria feito:")
        elif n_criadas or resultado["categorias_novas"]:
            try:
                status = mp_reconcile.StatusTracker.update(
                    db, tenant_id, "last_expenses_api",
                    criadas=n_criadas,
                    categorias_novas=resultado["categorias_novas"],
                    ignoradas_receita=resultado["ignoradas_receita"],
                    ignoradas_duplicata_cruzada=resultado.get("ignoradas_duplicata_cruzada", 0),
                )
                source.write_fields({
                    "categories": db.get("categories", []),
                    "expenses": db.get("expenses", []),
                    "mercado_pago_status": status,
                })
            except Exception as e:
                return "erro", f"Falha ao gravar os dados de volta ({source.describe()}): {e}"

        linhas = [
            f"Fonte: {source.describe()} | Conta: {conta_email}",
            f"{n_criadas} despesa(s) gerada(s) a partir do Mercado Pago"
            + (f" ({resultado['categorias_novas']} categoria(s) nova(s) criada(s))" if resultado["categorias_novas"] else "")
            + ".",
        ]
        for e in resultado["criadas"]:
            linhas.append(f"  - {e['date']} · R$ {e['amount']:.2f} · {e['description']}")
        if resultado["ignoradas_receita"]:
            linhas.append(
                f"{resultado['ignoradas_receita']} pagamento(s) ignorado(s) por já serem cobranças recebidas "
                "pela própria chave Pix do app (não são despesa)."
            )
        if resultado["ignoradas_duplicadas"]:
            linhas.append(f"{resultado['ignoradas_duplicadas']} pagamento(s) ignorado(s) por já terem sido importados antes.")
        if resultado.get("ignoradas_duplicata_cruzada"):
            linhas.append(
                f"{resultado['ignoradas_duplicata_cruzada']} pagamento(s) ignorado(s) por provável duplicata cruzada "
                "com uma despesa já gerada pelo outro caminho (API x e-mail, mesmo valor+data)."
            )
        if resultado["ignoradas_filtro"]:
            linhas.append(
                f"{resultado['ignoradas_filtro']} pagamento(s) ignorado(s) pelo filtro \"ignorar_descricoes_contendo\"."
            )
        if resultado.get("ignoradas_verificacao"):
            linhas.append(
                f"{resultado['ignoradas_verificacao']} pagamento(s) ignorado(s) por falha na verificação "
                "de transação/comprovante."
            )

        msg = "\n".join(linhas)
        icon = "✅" if n_criadas else "ℹ️"
        print(f"\n{icon} {msg}")

        return ("ok" if n_criadas else "sem_novidades"), msg


def run(args):
    return MercadoPagoExpenseAgent().run(args)


def main():
    ap = argparse.ArgumentParser(
        description="Gera despesas no painel web a partir de pagamentos reais do Mercado Pago."
    )
    ap.add_argument("--config", default="mp_expenses_config.json", help="Caminho do config (veja mp_expenses_config.example.json)")
    ap.add_argument("--dias", type=int, default=None, help="Quantos dias para trás buscar no Mercado Pago (padrão: 30, ou \"janela_dias\" do config)")
    ap.add_argument("--firebase-service-account", dest="firebase_service_account", default=None, help="Sobrescreve \"firebase_service_account\" do config")
    ap.add_argument("--db-json", dest="db_json", default=None, help="Sobrescreve \"db_json\" do config (fonte alternativa sem Firebase)")
    ap.add_argument("--dry-run", dest="dry_run", action="store_true", help="Mostra o que seria gerado sem gravar nada")
    args = ap.parse_args()

    try:
        resultado, msg = run(args)
    except Exception:
        print("\n❌ ERRO ao gerar despesas a partir do Mercado Pago:")
        traceback.print_exc()
        log(f"ERRO: {traceback.format_exc()}")
        sys.exit(1)

    sys.exit(0 if resultado in ("ok", "sem_novidades") else 1)


if __name__ == "__main__":
    main()
