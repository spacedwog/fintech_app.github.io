# Plano de Testes de Performance e Carga

**Versão:** 1.0  
**Data:** 2026-08-14

## Objetivo

Validar desempenho das operações críticas de cadastro, login, despesas e visão de orçamento.

## Cenários mínimos

1. Cadastro + login em sequência (100 iterações).
2. Inserção de despesas em lote (500 lançamentos).
3. Cálculo de visão de orçamento mensal com múltiplas categorias.

## Critérios de aceitação (ambiente local de referência)

- Cadastro + login: p95 <= 350 ms por operação lógica.
- Inserção em lote: conclusão <= 5 s.
- Visão de orçamento: p95 <= 400 ms.

## Evidência

Executar `node tests/performance-smoke.test.js` e guardar saída do run como anexo de evidência mensal.
