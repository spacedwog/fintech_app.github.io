# Métricas de Qualidade (ISO/IEC 25010)

**Versão:** 1.0  
**Data:** 2026-08-14

## Métricas definidas

- **Confiabilidade:** taxa de sucesso dos testes de integração (`tests/*.test.js`) >= 95% por execução.
- **Segurança:** 0 achados críticos em revisão de segurança automatizada por ciclo.
- **Manutenibilidade:** cobertura dos fluxos críticos por testes de integração obrigatórios antes de mudanças.
- **Eficiência de desempenho:** tempo de resposta médio das operações principais em ambiente local dentro da meta definida em `teste-performance.md`.
- **Usabilidade:** execução recorrente de sessões com usuários reais e registro de achados priorizados.

## Governança

- Medição mínima mensal.
- Publicação interna de resultados e plano de ação para métricas abaixo da meta.
