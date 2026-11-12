# Gmail API — configuração e deploy do formulário de contatos

## O que será publicado

O formulário em `skills.html` chama `POST /api/v1/leads`. O backend Spring Boot obtém access tokens usando OAuth refresh token e envia uma notificação para a equipe comercial e uma confirmação ao visitante. O arquivo `contato-enviado.html` é exibido após o envio bem-sucedido.

## Criar credenciais Google

1. Acesse [Google Cloud Console](https://console.cloud.google.com/) e selecione/crie um projeto.
2. Em **APIs e serviços → Biblioteca**, habilite **Gmail API**.
3. Configure a tela de consentimento OAuth: nome do app, contatos de suporte/desenvolvedor e público (Interno apenas para usuários Google Workspace da organização; Externo para contas pessoais/outros usuários). Se o app estiver em modo de teste, adicione a conta que enviará e-mails como usuário de teste.
4. Em **Público-alvo / Acesso a dados** (ou **Tela de consentimento OAuth → Escopos**, conforme a interface), habilite/adicione apenas `https://www.googleapis.com/auth/gmail.send`.
5. Em **APIs e serviços → Credenciais**, crie um **ID do cliente OAuth**. Use **Aplicativo para computador** para gerar o token manualmente ou **Aplicativo da Web** com redirect URI previamente registrado. Guarde Client ID e Client Secret em local seguro.
6. Obtenha o refresh token para a mesma caixa Gmail que será o remetente. Uma alternativa é o [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/): em ⚙ marque **Use your own OAuth credentials**, informe Client ID/Secret, autorize o escopo `https://www.googleapis.com/auth/gmail.send`, entre na conta remetente e troque o authorization code por tokens. Copie o refresh token.
7. O remetente configurado precisa corresponder à conta Gmail autorizada (ou a um alias habilitado nela). Em produção, revise as exigências de verificação OAuth do Google e as políticas de acesso/usuários de teste do projeto.

> O refresh token é uma credencial de longo prazo. Não o envie por e-mail, não o inclua no código, no frontend ou no Git. Revogue-o no Google Account se houver exposição. Tokens de aplicativos OAuth externos em modo de teste podem expirar; confirme o status de publicação/teste no projeto Cloud.

## Variáveis de ambiente

Configure no ambiente do processo Java, secret manager ou painel do host — nunca em `index.html`/`skills.html`:

| Variável | Valor |
| --- | --- |
| `GOOGLE_GMAIL_CLIENT_ID` | Client ID OAuth criado no Google Cloud |
| `GOOGLE_GMAIL_CLIENT_SECRET` | Client Secret do mesmo cliente |
| `GOOGLE_GMAIL_REFRESH_TOKEN` | Refresh token autorizado com `gmail.send` |
| `GOOGLE_GMAIL_SENDER` | Endereço autenticado no Gmail |
| `GOOGLE_GMAIL_SALES_INBOX` | Caixa comercial que receberá os leads |
| `APP_JWT_SECRET` | Segredo aleatório forte do backend já necessário para produção |

Exemplo local (não salve este arquivo com valores reais nem o comite):

```bash
export GOOGLE_GMAIL_CLIENT_ID='seu-client-id'
export GOOGLE_GMAIL_CLIENT_SECRET='seu-client-secret'
export GOOGLE_GMAIL_REFRESH_TOKEN='seu-refresh-token'
export GOOGLE_GMAIL_SENDER='remetente@gmail.com'
export GOOGLE_GMAIL_SALES_INBOX='comercial@seudominio.com'
export APP_JWT_SECRET='substitua-por-um-segredo-aleatorio-forte'
cd backend
mvn clean package
java -jar target/fintech-api.jar
```

No GitHub Actions, configure cada valor em **Settings → Secrets and variables → Actions** e injete-os como `env` no workflow de deploy. Em outras plataformas, use o painel de secrets/variáveis do serviço. Evite imprimir valores em logs.

## Deploy e validação

1. Confira que o domínio/site serve a página e o backend com HTTPS.
2. Na pasta `backend/`, execute `mvn clean package`; o build inclui as páginas estáticas e gera `target/fintech-api.jar`.
3. Publique o JAR no serviço Java, configure as variáveis acima e inicie com `java -jar target/fintech-api.jar` (ou o comando de execução do host).
4. Verifique a saúde do backend em `/actuator/health` se habilitado no deploy.
5. Abra `/skills.html`, envie um contato de teste com consentimento explícito e confirme: página de sucesso, mensagem recebida na caixa comercial e confirmação no endereço informado.
6. Sem as credenciais, o endpoint retorna indisponibilidade, não envia e-mails.

## Operação e segurança

O endpoint permite POST público, valida os campos, usa honeypot e aplica limite local de 5 envios por IP/hora. Esse limite em memória é apropriado somente para baixo volume/instância única; use rate limit no gateway/Redis e CAPTCHA em produção. Verifique as regras de retenção e privacidade LGPD, proteja dados pessoais nos logs e não use os contatos para marketing além da finalidade/consentimento informado.
