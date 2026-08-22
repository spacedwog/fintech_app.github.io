#!/usr/bin/env python3
"""
Lista as atividades (pagamentos) reais da conta do Mercado Pago -- sem gerar
nenhuma despesa, sem precisar do Firestore/Firebase nem de nenhuma cópia do
banco do painel web. Só o Access Token já configurado (reaproveita
config.json/mp_reconcile_config.json/mp_expenses_config.json -- qualquer um
dos três funciona, é o mesmo token/mesma conta) e a API de busca de
pagamentos do Mercado Pago (mp_sync.fetch_mp_payments -- a mesma usada por
mp_sync.py, mp_reconcile.py e mp_expenses.py).

Por que existe: antes de rodar mp_expenses.py/mp_reconcile.py de verdade
(que exigem Firebase configurado -- ver orcamento_agent/LEIA-ME.md), é útil
conseguir ver rapidinho o que existe na conta: quantos pagamentos, que
valores, que descrições -- sem nenhum pré-requisito além do token que já
está em config.json.

Uso:
  python3 mp_list_activities.py                          (últimos 30 dias, config.json)
  python3 mp_list_activities.py --dias 90
  python3 mp_list_activities.py --status approved         (só um status)
  python3 mp_list_activities.py --categoria Transporte    (só uma categoria)
  python3 mp_list_activities.py --config mp_expenses_config.json
  python3 mp_list_activities.py --export atividades.csv   (também salva um CSV)
  python3 mp_list_activities.py --export atividades.json  (ou um JSON, pela extensão)

Categorização: cada pagamento é categorizado pelo agente IA heurístico
de mp_expenses.py (`mp_expenses.ExpenseCategorizer`), com apoio do
"mapeamento"/"categoria_padrao" do config carregado (ex.:
mp_expenses_config.json, que já costuma ter essas chaves -- ver
mp_expenses_config.example.json). Se o config não tiver "mapeamento" (caso de
um config.json simples, só com o token), todo pagamento cai na categoria
padrão ("Mercado Pago" ou o que estiver em "categoria_padrao").

Nunca grava nada no painel web nem no Mercado Pago -- é só leitura.

Reescrito em POO: ActivityFormatter (linha de tabela + resumo por status/
categoria) e ActivityExporter (CSV/JSON) compõem MercadoPagoActivityLister,
que orquestra list_activities() de ponta a ponta. A função de módulo
`list_activities` é a costura que o teste usa (monkeypatcha
mp_sync.fetch_mp_payments, mesmo espírito dos outros testes desta pasta).
"""
import argparse
import csv
import json
import os
import sys
import traceback

import mp_expenses  # ExpenseCategorizer -- mesma categorização por palavra-chave do mp_expenses.py
import mp_reconcile  # DateParser.day_range -- mesma janela [hoje - dias, hoje] dos outros scripts
import mp_sync  # fetch_mp_payments -- mesma busca já usada pela suite inteira


def find_default_config():
    """Qualquer um dos configs já usados na pasta serve (mesmo token/
    mesma conta) -- prioriza o mais simples (config.json, do mp_sync.py, que
    não exige conta_email nem fonte de dados do app) para reduzir o quanto
    precisa estar pronto só para listar atividades."""
    candidatos = ["config.json", "mp_reconcile_config.json", "mp_expenses_config.json"]
    for nome in candidatos:
        if os.path.exists(nome):
            return nome
    return "config.json"


class ActivityFormatter:
    STATUS_ICONS = {
        "approved": "✅",
        "pending": "⏳",
        "in_process": "⏳",
        "rejected": "❌",
        "cancelled": "🚫",
        "refunded": "↩️",
        "charged_back": "↩️",
    }

    @classmethod
    def linha(cls, p):
        data = (p.get("date_approved") or p.get("date_created") or "")[:10] or "----------"
        valor = p.get("transaction_amount", 0) or 0
        status = p.get("status", "?")
        icon = cls.STATUS_ICONS.get(status, "•")
        desc = p.get("description") or p.get("statement_descriptor") or "(sem descrição)"
        metodo = p.get("payment_method_id") or "-"
        payer = ((p.get("payer") or {}).get("email")) or "-"
        categoria = p.get("categoria") or "-"
        return f"{icon} {data} | R$ {valor:>10.2f} | {status:<12} | {categoria:<24} | {metodo:<14} | {payer:<28} | {desc[:40]} | #{p.get('id')}"

    @staticmethod
    def cabecalho():
        return (
            "   Data       |     Valor      | Status       | Categoria                | Método         | Pagador                      | Descrição                                | ID\n"
            + "-" * 175
        )

    @staticmethod
    def resumo(payments):
        por_status = {}
        por_categoria = {}
        total_aprovado = 0.0
        for p in payments:
            status = p.get("status", "?")
            por_status[status] = por_status.get(status, 0) + 1
            categoria = p.get("categoria") or "-"
            por_categoria[categoria] = por_categoria.get(categoria, 0) + 1
            if status == "approved":
                total_aprovado += float(p.get("transaction_amount", 0) or 0)
        linhas = [f"{len(payments)} atividade(s) encontrada(s) no período."]
        if por_status:
            partes = ", ".join(f"{qtd} {status}" for status, qtd in sorted(por_status.items(), key=lambda kv: -kv[1]))
            linhas.append(f"Por status: {partes}.")
        if por_categoria:
            partes_cat = ", ".join(f"{qtd} {categoria}" for categoria, qtd in sorted(por_categoria.items(), key=lambda kv: -kv[1]))
            linhas.append(f"Por categoria: {partes_cat}.")
        linhas.append(f"Total aprovado no período: R$ {total_aprovado:.2f}.")
        return "\n".join(linhas)


class ActivityExporter:
    @staticmethod
    def export(payments, path):
        ext = os.path.splitext(path)[1].lower()
        if ext == ".json":
            with open(path, "w", encoding="utf-8") as f:
                json.dump(payments, f, ensure_ascii=False, indent=2)
            return
        # Qualquer outra extensão (inclusive .csv) cai no CSV -- formato mais
        # fácil de abrir numa planilha para conferir manualmente.
        campos = ["id", "status", "categoria", "date_created", "date_approved", "transaction_amount", "description", "statement_descriptor", "payment_method_id", "payer_email"]
        with open(path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=campos, extrasaction="ignore")
            writer.writeheader()
            for p in payments:
                linha = dict(p)
                linha["payer_email"] = (p.get("payer") or {}).get("email")
                writer.writerow(linha)


class MercadoPagoActivityLister:
    def list_activities(self, args):
        """Busca e formata as atividades -- devolve (resultado, mensagem),
        no mesmo estilo dos outros scripts desta pasta. Não grava nada no
        painel web nem no Mercado Pago (é só leitura)."""
        config_path = args.config or find_default_config()
        if not os.path.exists(config_path):
            return "erro", (
                f"Config não encontrado: {config_path}. Configure ao menos um dos arquivos desta pasta "
                "com o Access Token do Mercado Pago (config.json é o mais simples -- veja config.example.json)."
            )

        with open(config_path, encoding="utf-8") as f:
            cfg = json.load(f)

        token = cfg.get("mercado_pago_access_token")
        if not token or str(token).startswith("COLE_"):
            return "erro", f"Access token do Mercado Pago não configurado em {config_path}."

        dias = args.dias or 30
        begin, end = mp_reconcile.DateParser.day_range(dias)
        print(f"Buscando atividades do Mercado Pago dos últimos {dias} dia(s) ({begin} a {end}), fonte: {config_path}...")
        try:
            payments = mp_sync.fetch_mp_payments(token, begin, end)
        except Exception as e:
            return "erro", f"Falha ao consultar o Mercado Pago: {e}"

        # Categoriza cada pagamento pelo mesmo agente IA heurístico do
        # mp_expenses.py, com apoio de "mapeamento"/"categoria_padrao" do
        # config carregado (sem mapeamento = fallback na categoria padrão).
        categorizer = mp_expenses.ExpenseCategorizer(
            mapeamento=cfg.get("mapeamento") or [],
            categoria_padrao=cfg.get("categoria_padrao") or mp_expenses.DEFAULT_CATEGORIA_PADRAO,
        )
        for p in payments:
            desc = p.get("description") or p.get("statement_descriptor") or "(sem descrição)"
            p["categoria"] = categorizer.categorize(
                desc,
                expense_type=(
                    p.get("type")
                    or p.get("operation_type")
                    or p.get("transaction_type")
                    or p.get("payment_type_id")
                ),
                transaction_direction=p.get("direction") or p.get("credit_debit_type") or p.get("creditDebitType"),
                transaction=p,
            )

        if args.status:
            payments = [p for p in payments if p.get("status") == args.status]

        if args.categoria:
            payments = [p for p in payments if p.get("categoria") == args.categoria]

        payments.sort(key=lambda p: p.get("date_created") or "", reverse=True)

        print()
        print(ActivityFormatter.cabecalho())
        for p in payments[: args.limit] if args.limit else payments:
            print(ActivityFormatter.linha(p))
        if args.limit and len(payments) > args.limit:
            print(f"... e mais {len(payments) - args.limit} (use --limit 0 para ver todas, ou --export para salvar tudo).")

        print()
        resumo = ActivityFormatter.resumo(payments)
        print(resumo)

        if args.export:
            ActivityExporter.export(payments, args.export)
            print(f"\nSalvo em {args.export} ({len(payments)} atividade(s)).")

        return "ok", resumo


def list_activities(args):
    return MercadoPagoActivityLister().list_activities(args)


def main():
    ap = argparse.ArgumentParser(
        description="Lista as atividades (pagamentos) reais da conta do Mercado Pago -- só leitura, sem Firebase."
    )
    ap.add_argument("--config", default=None, help="Caminho do config com o Access Token (padrão: primeiro entre config.json, mp_reconcile_config.json, mp_expenses_config.json que existir)")
    ap.add_argument("--dias", type=int, default=30, help="Quantos dias para trás buscar (padrão: 30)")
    ap.add_argument("--status", default=None, help="Filtra por status (ex.: approved, pending, rejected, cancelled)")
    ap.add_argument("--categoria", default=None, help="Filtra por categoria (mesma categorização por palavra-chave do mp_expenses.py, via \"mapeamento\" do config)")
    ap.add_argument("--limit", type=int, default=50, help="Quantas linhas mostrar no terminal (padrão: 50; use 0 para mostrar todas)")
    ap.add_argument("--export", default=None, help="Também salva tudo num arquivo (.csv ou .json, pela extensão)")
    args = ap.parse_args()

    try:
        resultado, msg = list_activities(args)
    except Exception:
        print("\n❌ ERRO ao listar atividades do Mercado Pago:")
        traceback.print_exc()
        sys.exit(1)

    sys.exit(0 if resultado == "ok" else 1)


if __name__ == "__main__":
    main()
