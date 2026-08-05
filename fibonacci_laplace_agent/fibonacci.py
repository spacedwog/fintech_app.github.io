"""
fibonacci_laplace_agent/fibonacci.py

Motor de evolução de layout no estilo Fibonacci:

    anterior  = histórico de layout criado
    atual     = layout criado (mais recente)
    fibonacci = anterior + atual
    anterior  = atual
    atual     = fibonacci

Cada "layout" aqui é um dict {categoria: valor} (ex.: Realizado por
categoria de um mês, ou uma previsão de ML). "+" soma os valores
categoria a categoria (união das chaves — quem só aparece de um lado
entra com o próprio valor).

Rodar N passos gera uma sequência que cresce como a sequência de
Fibonacci — só que em vez de números soltos, os termos são layouts
inteiros de orçamento. É uma forma simples de projetar crescimento
composto por categoria a partir do histórico real (ver teste em
test_pipeline.py: com layouts de valor único, a série de valores é
literalmente 1, 1, 2, 3, 5, 8, ...).
"""


def soma_layouts(anterior, atual):
    """Soma dois layouts (dict categoria -> valor), categoria a
    categoria. Categorias que só existem em um dos dois entram com o
    valor original (equivalente a considerar 0 do lado ausente)."""
    anterior = anterior or {}
    atual = atual or {}
    categorias = set(anterior) | set(atual)
    return {
        cat: round((anterior.get(cat, 0) or 0) + (atual.get(cat, 0) or 0), 2)
        for cat in categorias
    }


class FibonacciLayoutEngine:
    """Estado: anterior (histórico de layout criado) e atual (layout
    criado mais recente). Cada step() soma os dois e desloca a janela,
    exatamente como a recorrência de Fibonacci."""

    def __init__(self, historico_layout=None, layout_atual=None):
        self.anterior = dict(historico_layout or {})
        self.atual = dict(layout_atual or {})
        self.sequencia = [dict(self.anterior), dict(self.atual)]

    def step(self):
        """Um passo da recorrência: fibonacci = anterior + atual;
        anterior = atual; atual = fibonacci."""
        fibonacci = soma_layouts(self.anterior, self.atual)
        self.anterior = self.atual
        self.atual = fibonacci
        self.sequencia.append(dict(fibonacci))
        return fibonacci

    def evoluir(self, n=1):
        """Roda `n` passos e retorna o layout atual (o mais evoluído)."""
        for _ in range(max(0, n)):
            self.step()
        return self.atual

    def historico(self):
        """Sequência completa de layouts gerados, do histórico inicial
        até o mais recente."""
        return list(self.sequencia)
