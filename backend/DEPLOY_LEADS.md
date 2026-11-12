# Captação e gerenciamento de contatos (sem e-mail automático)

## O que o endpoint faz

A página `skills.html` envia os dados do formulário para `POST /api/v1/leads`. O endpoint valida o corpo, aplica limite básico por IP e grava o pedido de contato na tabela `leads`, criada pela migration Flyway `V3__leads.sql`. Nenhum e-mail é enviado; não existe integração de envio via Google/Gmail. A equipe pode consultar os registros diretamente na base de dados com acesso autorizado.

## Contrato HTTP

```http
POST /api/v1/leads
Content-Type: application/json
```

```json
{
  "name": "Nome do contato",
  "email": "contato@example.com",
  "phone": "(11) 99999-0000",
  "message": "Gostaria de saber mais.",
  "consent": true,
  "website": ""
}
```

Campos de entrada são limitados e validados. `website` é honeypot; preenchido, a chamada é aceita sem persistir. Resposta HTTP `201` significa que o pedido foi salvo, não que houve envio de e-mail. A rota é pública e tem CSRF ignorado apenas para `POST /api/v1/leads`.

## Desenvolvimento local

A configuração padrão usa H2 em memória. Rode `cd backend && mvn spring-boot:run`, então abra `/skills.html`. Como o banco é em memória, os registros desaparecem ao reiniciar a aplicação.

## Produção com PostgreSQL

1. Crie PostgreSQL gerenciado e configure as variáveis secretas `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` e `APP_JWT_SECRET`.
2. Use `backend/application-prod.example.properties` como modelo; os valores reais devem ficar no secret manager do provedor.
3. Na pasta `backend`, execute `mvn clean test package`.
4. Inicie o artefato com `java -jar target/fintech-api.jar --spring.profiles.active=prod`.
5. A migration Flyway `V3__leads.sql` cria automaticamente a tabela de contatos.
6. Envie um contato em `/skills.html` e confirme o registro na tabela com acesso administrativo protegido.

Não imprima dados pessoais em logs. Defina retenção e procedimento de exclusão conforme a política de privacidade/LGPD. O limite em memória é para implantação simples de uma instância; em escala, aplique rate limit compartilhado (gateway/Redis) e monitore abuso.
