# Política de Segurança da Informação

**Versão:** 1.0  
**Data:** 2026-08-14  
**Escopo:** Aplicação Fintech Spacecworp e seus dados operacionais.

## Objetivo

Estabelecer diretrizes para confidencialidade, integridade e disponibilidade das informações.

## Diretrizes obrigatórias

1. Senhas devem ser armazenadas somente em hash forte com salt (PBKDF2 já implementado).
2. Sessões devem usar tokens assinados e com expiração.
3. Acesso aos dados deve respeitar isolamento por conta (`tenant_id`) e papéis.
4. Alterações em código devem passar por testes automatizados antes de publicação.
5. Incidentes de segurança devem seguir o processo formal em `gestao-incidentes.md`.

## Papéis e responsabilidades

- **Direção:** aprovar política e revisar eficácia semestralmente.
- **Responsável de Segurança:** manter controles e evidências.
- **Time de Desenvolvimento:** cumprir SDLC seguro e corrigir não conformidades.

## Aprovação

Aprovada para uso interno em 2026-08-14 por:

- Direção da SPACECWORP
- Responsável técnico do produto
