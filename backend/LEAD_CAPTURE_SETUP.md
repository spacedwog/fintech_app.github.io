# Captação de contatos e envio automático de e-mail

A página `skills.html` apresenta o catálogo solicitado e o formulário público de contato. O backend expõe `POST /api/v1/leads`; após o consentimento explícito, envia pelo Gmail API uma notificação à equipe comercial e uma confirmação ao visitante. As credenciais OAuth ficam exclusivamente no servidor.

## Configuração da Gmail API

1. No Google Cloud Console, crie/seleciona um projeto, ative **Gmail API** e configure a tela de consentimento OAuth.
2. Crie credenciais OAuth de aplicação Web/Desktop e obtenha um refresh token para a conta que enviará mensagens, autorizando o escopo `https://www.googleapis.com/auth/gmail.send`.
3. Configure no ambiente do backend (não no JavaScript, Git ou página estática):
   - `GOOGLE_GMAIL_CLIENT_ID`
   - `GOOGLE_GMAIL_CLIENT_SECRET`
   - `GOOGLE_GMAIL_REFRESH_TOKEN`
   - `GOOGLE_GMAIL_SENDER` (endereço autenticado no Google)
   - `GOOGLE_GMAIL_SALES_INBOX` (caixa que receberá novos contatos)
4. Publique/reinicie o backend. Sem essas configurações, o formulário responde como temporariamente indisponível; nenhum segredo é enviado ao navegador.

A API limita cada endereço remoto a 5 envios por hora e usa campo honeypot. Para publicação com alto volume, substitua o limitador em memória por rate limit compartilhado (por exemplo, Redis/API gateway) e configure CAPTCHA/monitoramento. A aplicação só envia marketing/transacional solicitado no formulário, com consentimento expresso; aplique a política de privacidade/retencão LGPD correspondente.

## Endpoint

`POST /api/v1/leads` JSON: `name`, `email`, `phone` (opcional), `message` (opcional), `consent: true` e `website` (honeypot vazio). O endpoint está público e excluído de CSRF para permitir envio a partir da landing page; valida os campos e aplica limite de requisições.
