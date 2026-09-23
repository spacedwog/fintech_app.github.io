# Spacecworp | Gestão de Despesas Pessoais

[![Stack](https://img.shields.io/badge/stack-Fullstack%20Web-2563eb)](#)
[![Hospedagem](https://img.shields.io/badge/hospedagem-GitHub%20Pages-181717)](#)
[![Idioma](https://img.shields.io/badge/idioma-PT--BR-16a34a)](#)
[![Pagamentos](https://img.shields.io/badge/pagamentos-Pix%20real%20%2B%20Mercado%20Pago-00b1ea)](#)

A **Spacecworp** passa a se posicionar neste repositório como uma empresa de **gestão de despesas pessoais**, com uma plataforma focada em orçamento, controle de gastos, relatórios e pagamentos via Pix para pessoas físicas e grupos familiares.

O aplicativo React Native anterior foi removido do repositório para concentrar a operação nas entregas web, backend Java e desktop Cloud Engine.

## ✨ Destaques

- **Fluxo completo de orçamento e despesas** em tela paginada no `dashboard.html`.
- **Multiusuário por conta (tenant)** com perfis de acesso e administração de equipe.
- **Regras automáticas de categorização** para despesas sem categoria.
- **Relatórios operacionais** com indicadores, projeções e exportação (CSV/Excel/PDF).
- **Cobrança real via Pix** para upgrade de plano e excedente de uso.
- **Confirmação automática de pagamentos** usando integração local com Mercado Pago (`orcamento_agent/`).
- **LGPD e controles de privacidade** no produto web.

## ⚡️ Quickstart

### Executar localmente (modo estático)

1. Clone o repositório.
2. Abra `index.html` no navegador ou sirva o diretório com um servidor estático.
3. Acesse `login.html` para autenticação e depois `dashboard.html`.

### Executar localmente com o servidor Java

1. A partir da raiz do repositório, entre em `backend/`.
2. Execute `mvn spring-boot:run`.
3. Abra `http://localhost:8080/`.

Para validar exatamente o empacotamento usado na nuvem, execute `mvn clean package` e depois `java -jar target/fintech-api.jar`.

### Configuração de dados

- Na primeira execução, o app pode inicializar dados padrão a partir de `db.json`.
- No servidor Java, os dados da aplicação são persistidos no banco configurado pelo Spring (`spring.datasource.*`).
- Sem backend, o front-end usa fallback automático em `localStorage`.

### SpacecworpOauth

- O backend Java agora expõe o **SpacecworpOauth**, unificando os conceitos internos de **SpaceOauth** + **CworpOauth** + integração **AgentIA** em um único serviço reutilizável.
- Descoberta OpenID-like: `GET /api/v1/spacecworp-oauth/.well-known/openid-configuration`
- Fluxos disponíveis:
  - `POST /api/v1/spacecworp-oauth/authorize`
  - `POST /api/v1/spacecworp-oauth/token`
  - `POST /api/v1/spacecworp-oauth/introspect`
  - `POST /api/v1/spacecworp-oauth/revoke`
  - `GET /api/v1/spacecworp-oauth/userinfo`
- Administradores podem cadastrar aplicações de terceiros em `POST /api/v1/spacecworp-oauth/clients`.
- O serviço publica a marca **SPACECWORP** e o CNPJ `62.904.267/0001-60` nos metadados/tokens para integração institucional entre aplicações.
- O cliente padrão `spacecworpoauth-agent-ia` foi incluído para cenários de automação/AgentIA com escopo `marketplace:ai_agent`.

## 📦 Componentes do projeto

- **Frontend principal**: `index.html`, `login.html`, `dashboard.html`, `css/`, `js/`.
- **Camada de negócio client-side**: `js/api.js`.
- **Automação local opcional**: `orcamento_agent/`.
- **Backend Java/Spring Boot**: `backend/` (API REST e servidor único para o produto de gestão de despesas pessoais).
- **Cliente desktop Cloud Engine**: empacotado a partir de `backend/`.
- **Testes**: `tests/`.

## 🧪 Testes

O projeto possui suíte em `tests/`. Execute os testes já existentes conforme o fluxo adotado no repositório/equipe.

## ☁️ Cloud Engine Foundation

- O backend Java continua sendo o servidor principal na nuvem.
- A base inicial do **Cloud Engine** agora inclui domínio ERP em Java, banco relacional versionado com Flyway e endpoints de descoberta em `/api/v1/cloud-engine`.
- A migração completa de agentes Python, frontend JS e persistência legada continua planejada em fases para evitar quebra de compatibilidade.

## 🛡️ Segurança

- Não comite credenciais, tokens ou chaves de produção.
- Revise integrações financeiras antes de uso em ambiente real.
- Para políticas e conformidade, consulte a pasta `compliance/`.

## 🚀 Deploy

### Frontend estático

A aplicação continua compatível com hospedagem estática e com **GitHub Pages**.

### Servidor Java na nuvem

O diretório `backend/` agora empacota o frontend web dentro do artefato Spring Boot, permitindo publicar um único serviço Java na nuvem com site e API no mesmo domínio. Nesse modo, o backend REST passa a ser a origem principal dos dados em produção.

Fluxo sugerido:

1. Gere o artefato com `cd backend && mvn clean package`.
2. Publique em uma plataforma Java o JAR executável gerado em `target/` (ignore o arquivo `.jar.original`, quando existir).
3. Defina as variáveis de ambiente obrigatórias do backend, especialmente `PORT`, `APP_JWT_SECRET` e as credenciais externas já usadas pelo projeto.

### Desktop Cloud Engine

1. Gere os artefatos com `cd backend && mvn clean package`.
2. Execute o cliente desktop com `java -jar target/cloud-engine-desktop-jar-with-dependencies.jar`.
3. Opcionalmente defina `CLOUD_ENGINE_API_BASE` para apontar o JFrame para outro backend Java.

## ⭐ Mantenha-se atualizado

Acompanhe este repositório para receber atualizações de produto e arquitetura.

## 👋 Contribuição

Contribuições são bem-vindas. Abra uma issue para discutir mudanças maiores e envie PRs com escopo objetivo.
