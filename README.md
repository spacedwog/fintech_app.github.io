# Fintech Spacecworp

[![Stack](https://img.shields.io/badge/stack-Fullstack%20Web-2563eb)](#)
[![Hospedagem](https://img.shields.io/badge/hospedagem-GitHub%20Pages-181717)](#)
[![Idioma](https://img.shields.io/badge/idioma-PT--BR-16a34a)](#)
[![Pagamentos](https://img.shields.io/badge/pagamentos-Pix%20real%20%2B%20Mercado%20Pago-00b1ea)](#)

O **Fintech Spacecworp** é uma plataforma de gestão de despesas pessoais com frontend em HTML/CSS/JavaScript, autenticação e persistência via Firebase (Firestore), fallback em `localStorage` e suporte a pagamentos reais via Pix com confirmação opcional por API do Mercado Pago.

## ✨ Destaques

- **Fluxo completo de orçamento e despesas** em tela paginada no `dashboard.html`.
- **Multiusuário por conta (tenant)** com perfis de acesso e administração de equipe.
- **Regras automáticas de categorização** para despesas sem categoria.
- **Relatórios operacionais** com indicadores, projeções e exportação (CSV/Excel/PDF).
- **Cobrança real via Pix** para upgrade de plano e excedente de uso.
- **Confirmação automática de pagamentos** usando integração local com Mercado Pago (`orcamento_agent/`).
- **LGPD e consentimento de anúncios** na landing page (`index.html`).

## ⚡️ Quickstart

### Executar localmente (modo estático)

1. Clone o repositório.
2. Abra `index.html` no navegador ou sirva o diretório com um servidor estático.
3. Acesse `login.html` para autenticação e depois `dashboard.html`.

### Configuração de dados

- Na primeira execução, o app pode inicializar dados padrão a partir de `db.json`.
- Com Firebase configurado, os dados são sincronizados no Firestore.
- Sem Firebase, o sistema usa fallback automático em `localStorage`.

## 📦 Componentes do projeto

- **Frontend principal**: `index.html`, `login.html`, `dashboard.html`, `css/`, `js/`.
- **Camada de negócio client-side**: `js/api.js`.
- **Automação local opcional**: `orcamento_agent/`.
- **Backend auxiliar**: `backend/` (suporte a integrações específicas).
- **Testes**: `tests/`.

## 🧪 Testes

O projeto possui suíte em `tests/`. Execute os testes já existentes conforme o fluxo adotado no repositório/equipe.

## 🛡️ Segurança

- Não comite credenciais, tokens ou chaves de produção.
- Revise integrações financeiras antes de uso em ambiente real.
- Para políticas e conformidade, consulte a pasta `compliance/`.

## 🚀 Deploy

A aplicação é compatível com hospedagem estática e está preparada para **GitHub Pages**.

## ⭐ Mantenha-se atualizado

Acompanhe este repositório para receber atualizações de produto e arquitetura.

## 👋 Contribuição

Contribuições são bem-vindas. Abra uma issue para discutir mudanças maiores e envie PRs com escopo objetivo.
