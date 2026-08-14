# Avaliação Formal de Fornecedor de Nuvem (ISO/IEC 27017/27018)

**Versão:** 2.0  
**Data:** 2026-08-14

## Fornecedor avaliado

Google Firebase / Firestore.

## Critérios

- Segurança de acesso e segregação lógica
- Controles de proteção de dados pessoais
- Disponibilidade e continuidade
- Transparência contratual e suporte

## Resultado resumido

- **Segregação lógica:** atendida por regras de acesso por conta no aplicativo.
- **PII em nuvem pública:** tratamento alinhado a minimização e controle de consentimento.
- **Disponibilidade:** dependência relevante de provedor único (risco registrado em `matriz-riscos.md`).
- **Contratual/SLA:** formalizado com aceite da direção e plano de revisão periódica.

## Contrato/SLA com controles específicos

| Controle | Exigência acordada | Status |
|---|---|---|
| Disponibilidade | SLA mensal com meta de uptime e plano de continuidade | Aprovado pela direção |
| Gestão de incidentes | Janela de comunicação e trilha de escalonamento | Aprovado pela direção |
| Proteção de PII | Compromissos contratuais de privacidade e segurança | Aprovado pela direção |
| Auditoria e evidências | Revisão anual de conformidade do fornecedor | Aprovado pela direção |

## Histórico de revisão periódica do fornecedor

| Revisão | Data | Resultado |
|---|---|---|
| RV-2025-02 | 2025-12-10 | Fornecedor mantido, sem bloqueadores |
| RV-2026-01 | 2026-03-20 | Ajustes de cláusula de notificação concluídos |
| RV-2026-02 | 2026-06-25 | Fornecedor mantido com risco residual controlado |

## Decisão

Fornecedor aprovado com monitoramento trimestral contínuo e revisão formal anual de contrato/SLA.
