"""
fibonacci_laplace_agent/laplace.py

Pipeline Laplace: passado determina presente determina futuro (analogia
ao "demônio de Laplace" — dado o estado passado, o resto é calculável).

    passado  = DS - Regression Table
               (Previsto/Realizado histórico, lido via
               orcamento_agent/budget_layout.py)
    presente = ML Recognition + ML Training + ML Testing + ML Learning
    futuro   = Fibonacci
               (saída de fibonacci.FibonacciLayoutEngine)

Sem dependências externas (nem numpy, nem scikit-learn) — mesma filosofia
de dependências leves do resto do projeto (só stdlib + openpyxl para
ler a planilha). A regressão linear (mínimos quadrados) é implementada
em Python puro em OrdinaryLeastSquares (_ols).

Reescrito em POO: RegressionTableBuilder (passado), PatternRecognizer (ML
Recognition), OrdinaryLeastSquares + RegressionModelTrainer (ML Training),
ModelEvaluator (ML Testing) e IncrementalLearner (ML Learning) são classes
coesas, uma por responsabilidade; LaplacePipeline as compõe. As funções de
módulo já existentes (build_regression_table, ml_recognition, ml_training,
ml_testing, ml_learning, prever, _ols) continuam com a MESMA assinatura --
_ols em especial é importado diretamente pelo teste.
"""
from statistics import mean

from fibonacci import FibonacciLayoutEngine


# ---------------------------------------------------------------------
# passado: DS - Regression Table
# ---------------------------------------------------------------------

class RegressionTableBuilder:
    @staticmethod
    def build(rows):
        """Recebe as linhas já lidas via
        budget_layout.analyze_with_layout(...)['rows'] (cada uma com
        categoria/mes/previsto/realizado) e agrupa por categoria, preservando
        a ordem em que aparecem na planilha (assumida cronológica) — isso é
        a "regression table": uma série temporal de Realizado por
        categoria."""
        tabela = {}
        for r in rows:
            cat = r["categoria"]
            tabela.setdefault(cat, []).append({
                "mes": r.get("mes"),
                "previsto": r.get("previsto") or 0,
                "realizado": r.get("realizado") or 0,
            })
        return tabela


def build_regression_table(rows):
    return RegressionTableBuilder.build(rows)


# ---------------------------------------------------------------------
# presente: ML Recognition
# ---------------------------------------------------------------------

class PatternRecognizer:
    def __init__(self, limiar_anomalia=0.2):
        self.limiar_anomalia = limiar_anomalia

    def recognize(self, regression_table):
        """Reconhecimento de padrão por categoria: tendência (crescente /
        decrescente / estável, comparando a média da 1ª metade da série com
        a 2ª) e anomalias (pontos onde Realizado se desvia de Previsto acima
        de `limiar_anomalia`, padrão 20%)."""
        padroes = {}
        for cat, serie in regression_table.items():
            valores = [p["realizado"] for p in serie]
            n = len(valores)
            tendencia = "estavel"
            if n >= 2:
                metade = n // 2 or 1
                inicio = mean(valores[:metade])
                fim = mean(valores[-metade:])
                if fim > inicio * 1.05:
                    tendencia = "crescente"
                elif fim < inicio * 0.95:
                    tendencia = "decrescente"
            anomalias = [
                p for p in serie
                if (p["previsto"] or 0) > 0
                and abs(p["realizado"] - p["previsto"]) / p["previsto"] > self.limiar_anomalia
            ]
            padroes[cat] = {"tendencia": tendencia, "anomalias": anomalias, "n_pontos": n}
        return padroes


def ml_recognition(regression_table, limiar_anomalia=0.2):
    return PatternRecognizer(limiar_anomalia=limiar_anomalia).recognize(regression_table)


# ---------------------------------------------------------------------
# presente: ML Training (regressão linear — mínimos quadrados)
# ---------------------------------------------------------------------

class OrdinaryLeastSquares:
    """Regressão linear simples (mínimos quadrados) y = a + b*x, em
    Python puro."""

    @staticmethod
    def fit(xs, ys):
        n = len(xs)
        if n == 0:
            return 0.0, 0.0
        if n == 1:
            return ys[0], 0.0
        mx, my = mean(xs), mean(ys)
        sxx = sum((x - mx) ** 2 for x in xs)
        sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        b = sxy / sxx if sxx != 0 else 0.0
        a = my - b * mx
        return a, b

    @staticmethod
    def predict(modelo, x):
        return modelo["intercepto"] + modelo["inclinacao"] * x


def _ols(xs, ys):
    return OrdinaryLeastSquares.fit(xs, ys)


def prever(modelo, x):
    return OrdinaryLeastSquares.predict(modelo, x)


class RegressionModelTrainer:
    def train(self, regression_table):
        """Treina uma regressão linear (Realizado ~ índice temporal) por
        categoria."""
        modelos = {}
        for cat, serie in regression_table.items():
            xs = list(range(len(serie)))
            ys = [p["realizado"] for p in serie]
            a, b = OrdinaryLeastSquares.fit(xs, ys)
            modelos[cat] = {"intercepto": a, "inclinacao": b, "n_treino": len(serie)}
        return modelos


def ml_training(regression_table):
    return RegressionModelTrainer().train(regression_table)


# ---------------------------------------------------------------------
# presente: ML Testing
# ---------------------------------------------------------------------

class ModelEvaluator:
    def __init__(self, holdout=1):
        self.holdout = holdout

    def evaluate(self, regression_table):
        """Avalia, por categoria, um modelo treinado só com os pontos
        iniciais contra os últimos `holdout` pontos (série temporal — não
        embaralha). Retorna MAE e R² (quando há variância suficiente no
        teste para R² fazer sentido)."""
        metricas = {}
        for cat, serie in regression_table.items():
            n = len(serie)
            if n <= self.holdout:
                metricas[cat] = {"mae": None, "r2": None, "aviso": "dados insuficientes para teste"}
                continue
            treino, teste = serie[:-self.holdout], serie[-self.holdout:]
            a, b = OrdinaryLeastSquares.fit(list(range(len(treino))), [p["realizado"] for p in treino])

            reais, preds = [], []
            for i, p in enumerate(teste, start=len(treino)):
                preds.append(a + b * i)
                reais.append(p["realizado"])

            mae = mean(abs(y - p) for y, p in zip(reais, preds))
            if len(set(reais)) > 1:
                media_real = mean(reais)
                ss_tot = sum((y - media_real) ** 2 for y in reais)
                ss_res = sum((y - p) ** 2 for y, p in zip(reais, preds))
                r2 = round(1 - (ss_res / ss_tot), 4) if ss_tot != 0 else None
            else:
                r2 = None
            metricas[cat] = {"mae": round(mae, 2), "r2": r2}
        return metricas


def ml_testing(regression_table, holdout=1):
    return ModelEvaluator(holdout=holdout).evaluate(regression_table)


# ---------------------------------------------------------------------
# presente: ML Learning (aprendizado incremental)
# ---------------------------------------------------------------------

class IncrementalLearner:
    def __init__(self, trainer=None):
        self.trainer = trainer or RegressionModelTrainer()

    def learn(self, regression_table, novo_ponto_por_categoria=None):
        """Incorpora novos pontos (ex.: mês novo lido num próximo ciclo do
        ETL) à regression table e retreina — "aprendizado contínuo" simples:
        cada rodada do pipeline pode agregar dado novo antes de re-treinar."""
        atualizada = {cat: list(serie) for cat, serie in regression_table.items()}
        for cat, ponto in (novo_ponto_por_categoria or {}).items():
            atualizada.setdefault(cat, []).append(ponto)
        return atualizada, self.trainer.train(atualizada)


def ml_learning(regression_table, novo_ponto_por_categoria=None):
    return IncrementalLearner().learn(regression_table, novo_ponto_por_categoria)


# ---------------------------------------------------------------------
# Pipeline: passado -> presente -> futuro
# ---------------------------------------------------------------------

class LaplacePipeline:
    def __init__(self, rows_passado):
        self.passado = RegressionTableBuilder.build(rows_passado)
        self.presente = {}
        self.futuro = {}
        self._recognizer = PatternRecognizer()
        self._trainer = RegressionModelTrainer()
        self._learner = IncrementalLearner(self._trainer)

    def rodar_presente(self, holdout=1, novo_ponto_por_categoria=None):
        atualizada, learning = self._learner.learn(self.passado, novo_ponto_por_categoria)
        self.presente = {
            "recognition": self._recognizer.recognize(self.passado),
            "training": self._trainer.train(self.passado),
            "testing": ModelEvaluator(holdout=holdout).evaluate(self.passado),
            "learning": learning,
        }
        if novo_ponto_por_categoria:
            self.passado = atualizada
        return self.presente

    def prever_proximo(self):
        """Usa os modelos treinados em `presente.training` para prever o
        próximo ponto (x = tamanho da série) por categoria — vira o
        "layout atual" que alimenta o Fibonacci."""
        modelos = self.presente.get("training") or self._trainer.train(self.passado)
        return {
            cat: round(OrdinaryLeastSquares.predict(modelos[cat], len(serie)), 2)
            for cat, serie in self.passado.items()
        }

    def rodar_futuro(self, historico_layout, layout_atual, n_fibonacci=1):
        """futuro = Fibonacci: evolui histórico + layout atual (que já
        pode incorporar a previsão de ML) N vezes, no estilo
        anterior/atual/fibonacci."""
        motor = FibonacciLayoutEngine(historico_layout, layout_atual)
        motor.evoluir(n_fibonacci)
        self.futuro = {
            "layout_projetado": motor.atual,
            "historico_sequencia": motor.historico(),
        }
        return self.futuro
