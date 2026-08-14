# Matriz de Riscos (ISO 31000)

**Versão:** 1.0  
**Data:** 2026-08-14

## Metodologia

- Probabilidade: 1 (baixa) a 5 (alta)
- Impacto: 1 (baixo) a 5 (alto)
- Nível = Probabilidade x Impacto
- Faixas: 1-5 (baixo), 6-12 (médio), 15-25 (alto)

## Registro formal

| ID | Risco | Causa | Prob. | Impacto | Nível | Dono | Tratamento | Monitoramento |
|---|---|---|---:|---:|---:|---|---|---|
| R-001 | Dependência de provedor único de nuvem | Firebase como backend principal | 4 | 4 | 16 | Responsável de Plataforma | Plano de contingência offline/localStorage e estratégia de exportação periódica | Revisão mensal de disponibilidade e custos |
| R-002 | Uso indevido de credenciais | Vazamento local do dispositivo do usuário | 3 | 5 | 15 | Responsável de Segurança | Hash forte, expiração de tokens, revogação de sessão, orientação de senha forte | Métrica mensal de tentativas de login falhas |
| R-003 | Exposição indevida de dados pessoais | Erro de configuração de acesso por conta | 2 | 5 | 10 | Responsável de Produto | Revisão de regras de acesso e testes de isolamento por `tenant_id` | Auditoria interna trimestral |
| R-004 | Indisponibilidade de integrações financeiras | Falha externa em API de pagamentos | 3 | 4 | 12 | Responsável de Integrações | Reprocessamento assíncrono e estado pendente auditável | Verificação diária dos sync jobs |
| R-005 | Não conformidade regulatória | Falta de atualização documental | 3 | 4 | 12 | DPO / Qualidade | Ciclo de revisão documental trimestral e trilha de auditoria | Checklist trimestral de compliance |

## Critérios de resposta

- Risco alto: plano de ação em até 15 dias.
- Risco médio: plano de ação em até 45 dias.
- Risco baixo: aceitar ou melhorar quando houver mudança relevante.
