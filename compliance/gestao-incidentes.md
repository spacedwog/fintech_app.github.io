# Processo de Gestão de Incidentes de Segurança

**Versão:** 1.0  
**Data:** 2026-08-14

## Classificação

- **Severidade Alta:** vazamento de dados, indisponibilidade crítica, comprometimento de conta administrativa.
- **Severidade Média:** falhas de autenticação sem impacto amplo, degradação relevante.
- **Severidade Baixa:** eventos sem impacto direto ao usuário final.

## Fluxo formal

1. **Detecção e registro** (abrir ticket com data, origem e escopo).
2. **Triagem inicial** (até 4h para severidade alta).
3. **Contenção** (bloquear vetor de ataque, revogar sessão/tokens quando aplicável).
4. **Erradicação e correção** (patch e validação técnica).
5. **Recuperação** (restabelecer serviço monitorado).
6. **Lições aprendidas** (RCA em até 5 dias úteis para alta severidade).

## Comunicação

- Incidentes de dados pessoais devem ser escalados ao DPO.
- Direção recebe relatório executivo para severidade alta e média.

## Evidências mínimas

- Linha do tempo
- Sistemas afetados
- Impacto estimado
- Ações corretivas e preventivas
- Responsável e prazo de fechamento
