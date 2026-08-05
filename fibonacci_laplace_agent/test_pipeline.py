"""
Teste ponta-a-ponta do fibonacci_laplace_agent, sem depender de nenhum
orçamento real: a planilha é montada na hora (mesmo estilo de
orcamento_agent/test_mp_sync.py), com números escolhidos para dar
resultados exatos e conferíveis na regressão, no teste e no Fibonacci.
"""
import openpyxl

from fibonacci import FibonacciLayoutEngine, soma_layouts
from laplace import LaplacePipeline, _ols
from etl_pipeline import ETLPipeline

TEST_PLANILHA = "TEST_Orcamento_Fibonacci.xlsx"

# ---------------------------------------------------------------------
# 1) fibonacci.py isolado — prova que a recorrência é literalmente
#    Fibonacci quando os layouts têm valor único.
# ---------------------------------------------------------------------
assert soma_layouts({"x": 2}, {"x": 3}) == {"x": 5}
assert soma_layouts({"a": 1}, {"b": 1}) == {"a": 1, "b": 1}  # categorias diferentes, sem perda

motor = FibonacciLayoutEngine({"x": 1}, {"x": 1})
valores = [motor.anterior["x"], motor.atual["x"]]
for _ in range(6):
    motor.step()
    valores.append(motor.atual["x"])
assert valores == [1, 1, 2, 3, 5, 8, 13, 21], valores
print("OK fibonacci.py — sequência 1,1,2,3,5,8,13,21:", valores)

# ---------------------------------------------------------------------
# 2) _ols isolado
# ---------------------------------------------------------------------
a, b = _ols([0, 1, 2], [100, 200, 300])
assert (round(a, 4), round(b, 4)) == (100.0, 100.0), (a, b)
print("OK _ols — reta perfeita y = 100 + 100x")

# ---------------------------------------------------------------------
# 3) planilha sintética (formato "largo"), 2 categorias x 3 meses
# ---------------------------------------------------------------------
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Orcamento"
# linha 1 (monthRow): categoria | Mes1 | (fill) | Mes2 | (fill) | Mes3 | (fill)
ws.append([None, "Mes1", None, "Mes2", None, "Mes3", None])
# linha 2 (subHeaderRow): Previsto/Realizado por par de colunas
ws.append([None, "Previsto", "Realizado", "Previsto", "Realizado", "Previsto", "Realizado"])
# dados: Alimentação cresce linear (100,200,300) com 1 desvio (previsto 150 no mês 2)
ws.append(["Alimentação", 100, 100, 150, 200, 300, 300])
# Transporte constante (50,50,50), sem desvio
ws.append(["Transporte", 50, 50, 50, 50, 50, 50])
wb.save(TEST_PLANILHA)

layout = {"sheetName": "Orcamento", "format": "largo", "colCategoriaLarga": "A", "monthRow": 1, "subHeaderRow": 2}

pipeline = ETLPipeline()
extraido = pipeline.extract(TEST_PLANILHA, layout)

assert extraido["historico_layout"] == {"Alimentação": 200, "Transporte": 50}, extraido["historico_layout"]
assert extraido["layout_atual"] == {"Alimentação": 300, "Transporte": 50}, extraido["layout_atual"]
print("OK extract — snapshots mensais (histórico=Mes2, atual=Mes3):", extraido["historico_layout"], extraido["layout_atual"])

transformado = pipeline.transform(extraido, n_fibonacci=1, holdout=1)

# --- passado (DS - Regression Table) ---
assert list(transformado["passado"].keys()) == ["Alimentação", "Transporte"]
assert [p["realizado"] for p in transformado["passado"]["Alimentação"]] == [100, 200, 300]
print("OK passado — regression table por categoria")

# --- presente: ML Recognition ---
rec = transformado["presente"]["recognition"]
assert rec["Alimentação"]["tendencia"] == "crescente", rec["Alimentação"]
assert rec["Transporte"]["tendencia"] == "estavel", rec["Transporte"]
assert len(rec["Alimentação"]["anomalias"]) == 1  # mês 2: previsto 150 x realizado 200 (>20%)
assert len(rec["Transporte"]["anomalias"]) == 0
print("OK presente.recognition — tendência e anomalia detectadas")

# --- presente: ML Training ---
tr = transformado["presente"]["training"]
assert (round(tr["Alimentação"]["intercepto"], 2), round(tr["Alimentação"]["inclinacao"], 2)) == (100.0, 100.0)
assert (round(tr["Transporte"]["intercepto"], 2), round(tr["Transporte"]["inclinacao"], 2)) == (50.0, 0.0)
print("OK presente.training — regressão linear por categoria")

# --- presente: ML Testing ---
te = transformado["presente"]["testing"]
assert te["Alimentação"]["mae"] == 0.0, te["Alimentação"]
assert te["Transporte"]["mae"] == 0.0, te["Transporte"]
print("OK presente.testing — MAE 0 nos dois casos (reta perfeita / constante)")

# --- presente: ML Learning ---
le = transformado["presente"]["learning"]
assert le["Alimentação"]["inclinacao"] == tr["Alimentação"]["inclinacao"]
print("OK presente.learning — retreina mantendo os parâmetros sem novo ponto")

# --- previsão de ML (próximo ponto, x = 3) ---
assert transformado["previsao_ml"] == {"Alimentação": 400.0, "Transporte": 50.0}, transformado["previsao_ml"]
print("OK previsao_ml — próximo ponto por categoria:", transformado["previsao_ml"])

# --- futuro (Fibonacci) ---
# atual (com previsão) = layout_atual + previsao_ml = {Alimentação: 700, Transporte: 100}
# fibonacci = historico_layout + atual = {Alimentação: 200+700=900, Transporte: 50+100=150}
futuro = transformado["futuro"]["layout_projetado"]
assert futuro == {"Alimentação": 900, "Transporte": 150}, futuro
print("OK futuro — layout projetado via Fibonacci:", futuro)

# --- load (grava JSON) ---
caminho = pipeline.load(transformado, "TEST_resultado_pipeline.json")
import json
with open(caminho, "r", encoding="utf-8") as f:
    salvo = json.load(f)
assert salvo["futuro"]["layout_projetado"] == futuro
print("OK load — JSON gravado e relido com o mesmo resultado")

# --- run() ponta-a-ponta ---
pipeline2 = ETLPipeline()
resultado, caminho2 = pipeline2.run(TEST_PLANILHA, layout, n_fibonacci=1, holdout=1, saida="TEST_resultado_run.json")
assert resultado["futuro"]["layout_projetado"] == futuro
print("OK run() — Extract -> Transform -> Load de ponta a ponta")

print("\nTODOS OS TESTES PASSARAM ✅")
