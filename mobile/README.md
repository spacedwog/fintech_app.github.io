# Fintech Spacecworp Mobile (React Native iOS)

Aplicativo mobile em React Native (Expo) com paridade funcional do sistema web atual.

## Escopo de paridade implementado

- Auth/OAuth: login, cadastro, consentimento OAuth, refresh, revogação e logout.
- Orçamento e despesas: alertas, visão previsto x realizado, importação de orçamento (CSV), gestão de despesas e regras automáticas.
- Transações e comprovantes: verificação de transação Mercado Pago, análise de comprovante e fallback manual.
- Pix: geração de payload copia-e-cola e confirmação via pagamento.
- Relatórios: indicadores/projeções/checklist e exportação mobile (compartilhamento).
- Conta e governança: equipe/convites, plano e histórico de pagamentos, comprovantes fiscais.
- Segurança e privacidade: trilha de auditoria, consentimento LGPD, exportação e exclusão de dados.
- Configurações: perfil, senha, endpoint API, sincronização offline e telemetria local.

## Estrutura por domínio

- `src/features/auth`
- `src/features/budget`
- `src/features/transactions`
- `src/features/reports`
- `src/features/team`
- `src/features/plan`
- `src/features/invoices`
- `src/features/security`
- `src/features/settings`

## Camada de dados/API

- `src/api/client.ts` reutiliza os contratos já existentes (`/api/v1/...`) do sistema.
- Sessão segura em `expo-secure-store`.
- Fila offline em `@react-native-async-storage/async-storage` com sincronização manual.

## Executar

```bash
cd mobile
npm install
npm run ios
```

## Verificação local

```bash
cd mobile
npx tsc --noEmit
```
