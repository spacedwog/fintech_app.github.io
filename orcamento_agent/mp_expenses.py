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

DEFAULT_IGNORAR_DESCRICOES = ["despesa extra", "assinatura", "fintech spacecworp"]
DEFAULT_CATEGORIA_PADRAO = "Mercado Pago (não categorizado)"


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


def gen_id(prefix):
    """Id único (string) no mesmo espírito do nextId() de js/db.js -- não
    precisa bater byte a byte com o formato do navegador, só ser uma string
    praticamente única (timestamp + sufixo aleatório)."""
    ts = format(int(time.time() * 1000), "x")
    rand = secrets.token_hex(4)
    return f"{prefix}{ts}{rand}"


def find_user_by_email(db, email):
    email_norm = str(email or "").strip().lower()
    for u in db.get("users", []):
        if str(u.get("email", "")).strip().lower() == email_norm:
            return u
    return None


def categorize(description, mapeamento):
    desc_norm = mp_sync.normalize(description)
    for regra in mapeamento or []:
        kw = mp_sync.normalize(regra.get("palavra_chave") or regra.get("keyword") or "")
        categoria = regra.get("categoria")
        if kw and categoria and kw in desc_norm:
            return categoria
    return None


def should_ignore(description, ignorar_lista):
    desc_norm = mp_sync.normalize(description)
    for termo in ignorar_lista or []:
        termo_norm = mp_sync.normalize(termo)
        if termo_norm and termo_norm in desc_norm:
            return True
    return False


def find_or_create_category(db, tenant_id, name):
    for c in db.get("categories", []):
        if c.get("tenant_id") == tenant_id and str(c.get("name", "")).strip().lower() == name.strip().lower():
            return c, False
    category = {"id": gen_id("cat"), "tenant_id": tenant_id, "name": name}
    db.setdefault("categories", []).append(category)
    return category, True


def generate_expenses(db, mp_payments, tenant_id, user_id, cfg):
    """Gera despesas em `db` (mutado in-place) a partir de `mp_payments`.
    Devolve um resumo -- não grava nada, quem chama decide (permite --dry-run)."""
    mapeamento = cfg.get("mapeamento") or []
    categoria_padrao = cfg.get("categoria_padrao") or DEFAULT_CATEGORIA_PADRAO
    ignorar = cfg.get("ignorar_descricoes_contendo")
    if ignorar is None:
        ignorar = DEFAULT_IGNORAR_DESCRICOES

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

    criadas = []
    ignoradas_duplicadas = 0
    ignoradas_receita = 0
    ignoradas_filtro = 0
    categorias_novas = 0

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
        if should_ignore(desc, ignorar):
            ignoradas_filtro += 1
            continue

        categoria_nome = categorize(desc, mapeamento) or categoria_padrao
        category, created = find_or_create_category(db, tenant_id, categoria_nome)
        if created:
            categorias_novas += 1

        valor = p.get("transaction_amount", 0) or 0
        data_iso = p.get("date_approved") or p.get("date_created") or ""
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
        }
        db.setdefault("expenses", []).append(expense)
        criadas.append(expense)

    return {
        "criadas": criadas,
        "categorias_novas": categorias_novas,
        "ignoradas_duplicadas": ignoradas_duplicadas,
        "ignoradas_receita": ignoradas_receita,
        "ignoradas_filtro": ignoradas_filtro,
    }


def run(args):
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
        f"ignoradas_filtro={resultado['ignoradas_filtro']}"
    )

    if args.dry_run:
        print("\n[dry-run] Nada foi gravado. Resumo do que seria feito:")
    elif n_criadas or resultado["categorias_novas"]:
        try:
            source.write_fields({"categories": db.get("categories", []), "expenses": db.get("expenses", [])})
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
    if resultado["ignoradas_filtro"]:
        linhas.append(
            f"{resultado['ignoradas_filtro']} pagamento(s) ignorado(s) pelo filtro \"ignorar_descricoes_contendo\"."
        )

    msg = "\n".join(linhas)
    icon = "✅" if n_criadas else "ℹ️"
    print(f"\n{icon} {msg}")

    return ("ok" if n_criadas else "sem_novidades"), msg


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
