#!/usr/bin/env python3
"""
fibonacci_laplace_agent/etl_pipeline.py

Pipeline ETL que encapsula Fibonacci (evolução de layout) e Laplace
(passado/presente/futuro) num fluxo Extract -> Transform -> Load:

  Extract:   lê a planilha de orçamento (Previsto/Realizado) usando
             orcamento_agent/budget_layout.py — vira o "passado" (DS -
             Regression Table) do Laplace, e os snapshots mensais
             {categoria: realizado} que alimentam o Fibonacci
             (anterior = histórico de layout criado, atual = layout
             criado mais recente).

  Transform: roda o "presente" do Laplace (ML Recognition + ML Training
             + ML Testing + ML Learning) sobre o passado, prevê o
             próximo ponto por categoria e soma essa previsão ao layout
             mais recente; em seguida evolui o Fibonacci
             (anterior + atual) — o resultado é o "futuro".

  Load:      grava passado/presente/futuro num JSON de saída.

Uso:
  python3 etl_pipeline.py --planilha caminho.xlsx --layout layout.json
  python3 etl_pipeline.py --planilha caminho.xlsx --layout layout.json \
      --n-fibonacci 3 --holdout 1 --saida resultado.json

O layout.json segue exatamente o formato de
orcamento_agent/budget_layout.py (mesmo conceito do modal "Configurar
layout de leitura" do painel web) — pode ser gerado com
`python3 mp_sync.py --criar-layout` dentro de orcamento_agent/.
"""
import argparse
import json
import os
import sys

import openpyxl

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "orcamento_agent"))
import budget_layout  # noqa: E402

from fibonacci import soma_layouts  # noqa: E402
from laplace import LaplacePipeline  # noqa: E402


def _snapshots_por_mes(rows):
    """Agrupa as linhas (já lidas pelo budget_layout) por mês, na ordem
    de primeira aparição, em snapshots {categoria: realizado} — cada
    snapshot é um "layout criado" na linguagem do Fibonacci."""
    ordem_meses = []
    por_mes = {}
    for r in rows:
        mes = r.get("mes") or "único"
        if mes not in por_mes:
            por_mes[mes] = {}
            ordem_meses.append(mes)
        por_mes[mes][r["categoria"]] = r.get("realizado") or 0
    return [por_mes[m] for m in ordem_meses]


class ETLPipeline:
    def __init__(self):
        self.passado_rows = None
        self.laplace = None

    # ---------------- Extract ----------------
    def extract(self, planilha, layout):
        wb = openpyxl.load_workbook(planilha, data_only=True)
        analise = budget_layout.analyze_with_layout(wb, layout)
        self.passado_rows = analise["rows"]
        snapshots = _snapshots_por_mes(self.passado_rows)
        return {
            "analise": analise,
            "historico_layout": snapshots[-2] if len(snapshots) >= 2 else {},
            "layout_atual": snapshots[-1] if snapshots else {},
        }

    # ---------------- Transform ----------------
    def transform(self, extraido, n_fibonacci=1, holdout=1):
        self.laplace = LaplacePipeline(self.passado_rows)
        presente = self.laplace.rodar_presente(holdout=holdout)
        previsao_ml = self.laplace.prever_proximo()

        # atual (Fibonacci) = layout mais recente + previsão de ML,
        # combinados pela mesma soma categoria-a-categoria do Fibonacci
        layout_atual_com_previsao = soma_layouts(extraido["layout_atual"], previsao_ml)

        futuro = self.laplace.rodar_futuro(
            extraido["historico_layout"], layout_atual_com_previsao, n_fibonacci=n_fibonacci
        )
        return {
            "passado": self.laplace.passado,
            "presente": presente,
            "futuro": futuro,
            "previsao_ml": previsao_ml,
        }

    # ---------------- Load ----------------
    def load(self, transformado, saida):
        with open(saida, "w", encoding="utf-8") as f:
            json.dump(transformado, f, ensure_ascii=False, indent=2, default=str)
        return saida

    # ---------------- run: Extract -> Transform -> Load ----------------
    def run(self, planilha, layout, n_fibonacci=1, holdout=1, saida="resultado_pipeline.json"):
        extraido = self.extract(planilha, layout)
        transformado = self.transform(extraido, n_fibonacci=n_fibonacci, holdout=holdout)
        caminho = self.load(transformado, saida)
        return transformado, caminho


def _parse_args():
    p = argparse.ArgumentParser(
        description="Pipeline ETL (Fibonacci + Laplace) sobre a planilha de orçamento."
    )
    p.add_argument("--planilha", required=True, help="Caminho da planilha de orçamento (.xlsx)")
    p.add_argument("--layout", required=True, help="Caminho do layout.json (ver orcamento_agent/budget_layout.py)")
    p.add_argument("--n-fibonacci", type=int, default=1, help="Passos de evolução Fibonacci a rodar (padrão: 1)")
    p.add_argument("--holdout", type=int, default=1, help="Pontos finais usados como teste na regressão (padrão: 1)")
    p.add_argument("--saida", default="resultado_pipeline.json", help="Arquivo JSON de saída")
    return p.parse_args()


def main():
    args = _parse_args()
    with open(args.layout, "r", encoding="utf-8") as f:
        layout = json.load(f)

    pipeline = ETLPipeline()
    resultado, caminho = pipeline.run(
        args.planilha, layout,
        n_fibonacci=args.n_fibonacci, holdout=args.holdout, saida=args.saida,
    )
    print(f"OK — pipeline rodado. Resultado salvo em {caminho}")
    print(f"Categorias no passado (DS - Regression Table): {len(resultado['passado'])}")
    print(f"Previsão ML (próximo ponto por categoria): {resultado['previsao_ml']}")
    print(f"Futuro (layout projetado via Fibonacci): {resultado['futuro']['layout_projetado']}")


if __name__ == "__main__":
    main()
