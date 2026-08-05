# Agente Fibonacci + Laplace (pipeline ETL)

## O que é
Um agente que projeta o orçamento à frente combinando duas ideias:

- **Fibonacci**: evolui o layout do orçamento somando o histórico com o mais
  recente, igual à recorrência de Fibonacci — só que em vez de números soltos,
  os termos são layouts inteiros (categoria → valor).
- **Laplace**: separa o problema em passado (dados históricos), presente
  (modelo de ML treinado nesses dados) e futuro (a saída do Fibonacci) —
  analogia ao "demônio de Laplace": dado o passado, o resto é calculável.

Tudo isso roda dentro de um **pipeline ETL** (Extract → Transform → Load).

## Mapeamento da especificação
| Conceito | Implementação |
|---|---|
| Fibonacci: `anterior` | histórico de layout criado (snapshot mensal anterior) |
| Fibonacci: `atual` | layout criado mais recente + previsão de ML |
| Fibonacci: `fibonacci = anterior + atual` | `fibonacci.soma_layouts()` (soma categoria a categoria) |
| Fibonacci: `anterior = atual; atual = fibonacci` | `FibonacciLayoutEngine.step()` |
| Laplace: `passado` | DS - Regression Table (`laplace.build_regression_table`), lida da planilha via `orcamento_agent/budget_layout.py` |
| Laplace: `presente` | ML Recognition + ML Training + ML Testing + ML Learning (`laplace.ml_recognition/ml_training/ml_testing/ml_learning`) |
| Laplace: `futuro` | Fibonacci (`LaplacePipeline.rodar_futuro`) |
| ETL (pipeline) | `etl_pipeline.ETLPipeline` — Extract / Transform / Load |

## Arquivos
- `fibonacci.py` — `soma_layouts()` e `FibonacciLayoutEngine` (anterior/atual/step/evoluir/histórico).
- `laplace.py` — `build_regression_table` (passado), `ml_recognition`/`ml_training`/`ml_testing`/`ml_learning`
  (presente, regressão linear em Python puro — sem numpy/scikit-learn, mesma filosofia de dependências
  leves do resto do projeto), e `LaplacePipeline` (orquestra passado → presente → futuro).
- `etl_pipeline.py` — `ETLPipeline` com `extract()`/`transform()`/`load()`/`run()`, e CLI.
- `test_pipeline.py` — teste ponta a ponta com planilha sintética (dados escolhidos para dar
  resultados exatos e conferíveis: regressão, MAE, R², sequência Fibonacci literal).

## Como usar
Requer só o que o resto do repo já usa: `pip install openpyxl` (nenhuma dependência de ML externa).

```
python3 etl_pipeline.py --planilha meu_orcamento.xlsx --layout layout.json
python3 etl_pipeline.py --planilha meu_orcamento.xlsx --layout layout.json --n-fibonacci 3 --saida resultado.json
```

- `--layout`: mesmo `layout.json` do `orcamento_agent` (formato "largo" ou "longo" — ver
  `orcamento_agent/budget_layout.py` e `orcamento_agent/layout.example.json`). Se não tiver um,
  gere com `python3 mp_sync.py --criar-layout` dentro de `orcamento_agent/`.
- `--n-fibonacci`: quantos passos de evolução Fibonacci rodar (padrão 1). Cada passo composta o
  crescimento — quanto mais passos, mais agressiva a projeção.
- `--holdout`: quantos pontos finais de cada categoria usar como teste na regressão (padrão 1).
- `--saida`: onde gravar o JSON com `passado`/`presente`/`futuro`/`previsao_ml`.

Rodar os testes: `python3 test_pipeline.py` (monta a própria planilha de teste, não usa nenhum
orçamento real).

## Limitações
- A regressão é linear simples (mínimos quadrados, uma reta por categoria) — captura tendência,
  não sazonalidade. Para séries curtas (poucos meses), a previsão e as métricas de teste (`mae`/`r2`)
  têm pouco significado estatístico; o código já sinaliza isso (`aviso: "dados insuficientes"`)
  quando não há pontos suficientes para o holdout escolhido.
- Assume que a ordem das linhas lidas pela planilha é cronológica por categoria (mesma suposição do
  `budget_layout.py` — sem heurística de data).
