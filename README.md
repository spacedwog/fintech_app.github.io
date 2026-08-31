# Fintech Spacecworp

![Fullstack](https://img.shields.io/badge/stack-Fullstack%20Web-2563eb)
![GitHub Pages](https://img.shields.io/badge/hospedagem-GitHub%20Pages-181717)
![Idioma](https://img.shields.io/badge/idioma-PT--BR-16a34a)
![Mercado Pago](https://img.shields.io/badge/pagamentos-Pix%20real%20%2B%20Mercado%20Pago-00b1ea)

Gestão de despesas pessoais em arquitetura **fullstack web**: frontend em HTML/CSS/JavaScript com persistência em **Firebase (Firestore)** na nuvem e fallback automático em **`localStorage`**. Cobranças (limite diário excedido, upgrade de plano) usam **Pix real**, com um agente local opcional que confirma automaticamente os pagamentos cruzando com a **API do Mercado Pago** — ver [Mercado Pago: confirmação automática de pagamentos](#mercado-pago-confirmação-automática-de-pagamentos).

> O antigo backend em Python (Streamlit e depois FastAPI) foi descontinuado. Toda a lógica de negócio (autenticação, multi-tenancy, planos, despesas, relatórios) roda em JavaScript no cliente. O `db.json` na raiz do repositório é só o "banco de fábrica" usado para popular o Firestore/localStorage na primeiríssima vez que o app é aberto.

## Sumário

- [Navegue pelo painel (`dashboard.html`)](#navegue-pelo-painel-dashboardhtml)
  - [🔄 Orçamento e Despesas (fluxo paginado)](#-orçamento-e-despesas-fluxo-paginado)
  - [Regras automáticas](#regras-automáticas)
  - [📊 Relatório](#-relatório)
  - [📰 Feed](#-feed)
  - [👥 Equipe](#-equipe)
  - [💳 Plano](#-plano)
  - [🔎 Verificação de transação Mercado Pago](#-verificação-de-transação-mercado-pago)
  - [🔒 Segurança e Privacidade (LGPD)](#-segurança-e-privacidade-lgpd)
  - [⚙️ Configurações](#️-configurações)
- [Mercado Pago: confirmação automática de pagamentos](#mercado-pago-confirmação-automática-de-pagamentos)
- [Landing page: anúncios Google (AdSense x Google Ads)](#landing-page-anúncios-google-adsense-x-google-ads)
- [Escopo funcional mínimo (core x complementar)](#escopo-funcional-mínimo-core-x-complementar)
- [Integração IBM/Mainframe (descontinuada)](#integração-ibmmainframe-descontinuada)
- [Nota Fiscal (NFS-e): emissão real via Focus NFe](#nota-fiscal-nfs-e-emissão-real-via-focus-nfe)
- [Como o sistema funciona por baixo dos panos](#como-o-sistema-funciona-por-baixo-dos-panos)
- [Grau tecnológico atual](#grau-tecnológico-atual)
- [Priorização tecnológica (sem perder o foco)](#priorização-tecnológica-sem-perder-o-foco)
- [Conectando ao Firebase](#conectando-ao-firebase)
- [Como rodar](#como-rodar)
- [Primeiro uso](#primeiro-uso)
- [Testes automatizados](#testes-automatizados)
- [Roadmap](#roadmap)
- [Limitações](#limitações)

---

## Landing page: anúncios Google (AdSense x Google Ads)

A landing (`index.html`) já está preparada com dois slots na seção **Patrocinado**, carregados somente após consentimento explícito do usuário.

### Passo a passo para publicar anúncios na landing

1. **Escolha a plataforma certa**
   - **AdSense**: monetiza o seu site exibindo anúncios de terceiros.
   - **Google Ads**: você paga para anunciar seu produto em outros sites.
2. **Configure e aprove sua conta no AdSense**
   - Crie/configure a conta.
   - Adicione o domínio e conclua a validação.
   - Aguarde aprovação do site nas políticas do Google.
3. **Troque o publisher ID de teste pelo seu**
   - Em `index.html`, ajuste `<meta name="google-adsense-account" content="ca-pub-...">` para o seu `ca-pub` real.
   - Esse valor também é aplicado automaticamente como `data-ad-client` em cada slot da landing.
4. **Troque os slots de anúncio**
   - Na seção `lp-ad-grid` de `index.html`, substitua `data-ad-slot` pelos IDs reais criados no painel do AdSense.
5. **Respeite consentimento**
   - A landing só carrega o script do AdSense após clique em **Permitir anúncios**.
   - Se negado, os espaços patrocinados ficam bloqueados.
6. **Publicação e validação**
   - Publique no domínio aprovado.
   - Confira no navegador se os blocos renderizam.
   - Valide no painel do AdSense se há requisições/impressões.
7. **Otimização**
   - Ajuste posições e formatos com base em CTR e conversão da landing.
   - Teste blocos manuais vs Auto Ads.

### Posso obter anúncios de Google Ads e/ou Google AdSense?

- **Google AdSense**: sim — é o produto para exibir anúncios de terceiros no seu site.
- **Google Ads**: não para monetizar a sua página; ele serve para você comprar tráfego para seu produto.

## Escopo funcional mínimo (core x complementar)

Para manter foco em **Gestão de Despesas Pessoais**, o produto passa a seguir esta separação explícita:

### Core do produto (prioridade máxima)
- Orçamento (importação, gestão e comparação Previsto x Realizado)
- Despesas (lançamento, categorização, regras automáticas e histórico)
- Alertas (limite geral e por categoria)
- Pagamentos do plano (Pix real + confirmação)
- Relatórios e feed operacional

### Complementar (suporte ao core)
- Ads na landing page
- Chatbot de apoio
- Integrações externas opcionais (Mercado Pago e Open Finance)
- Automações administrativas fora do navegador (`orcamento_agent/`)

## Integração IBM/Mainframe (descontinuada)

As conexões com legado IBM/Mainframe foram removidas com segurança.

- `orcamento_agent/cobol_bridge.py` e `orcamento_agent/ibm_tso_bridge.py` permanecem apenas por compatibilidade de CLI e retornam status de desativação.
- Não há mais abertura de sessão TSO, execução de comandos no Mainframe ou reconciliação COBOL ativa neste projeto.
- O foco de integrações externas ativas permanece em Mercado Pago e Open Finance.

## Navegue pelo painel (`dashboard.html`)

Depois do login, o painel tem nove seções na barra lateral (as sete primeiras são o app em si; as duas últimas, em "Conta", são Segurança e Privacidade em menu único paginado + Configurações). Clique em cada uma abaixo para expandir o que ela faz e onde está o código.

### 🔄 Orçamento e Despesas (fluxo paginado)

O menu **Orçamento e Despesas** (`view-budget-flow`) consolida orçamento e despesas em uma única tela com paginação.

1. **Página 1** grava o **Previsto** de cada categoria (a partir de uma planilha) no app.
2. **Página 2** compara o Previsto com o Realizado por categoria e exibe alertas.
3. **Página 3** permite gerenciar orçamentos por categoria.
4. **Página 4** exibe os grupos automáticos de orçamento/despesa.
5. **Página 5** reúne SpaceHub + Minhas despesas.
6. **Página 6** concentra o pagamento de despesa via Pix.

### Regras automáticas

O menu **Regras automáticas** (`view-expense-rules`) concentra o cadastro das palavras-chave de descrição/recebedor e a ação para classificar despesas sem categoria.

<details>
<summary><strong>Página 1 — Importar Orçamento</strong></summary>

Envie uma planilha de orçamento (.xlsx/.xls/.csv) direto do navegador — a leitura (categorias, Previsto/Realizado, quais categorias estouraram *segundo a planilha*) acontece **100% client-side**, sem subir o arquivo pra nenhum servidor (`js/budget-ai.js`, usa SheetJS + heurística de cabeçalho).

- **Detecção automática**: tenta reconhecer a planilha sozinha (coluna Categoria + Previsto/Realizado, formato largo ou longo).
- **Layout de leitura manual** ("+ Criar layout de leitura"): quando a heurística não reconhece o formato, um modal deixa você descrever exatamente onde está cada coisa (aba, linhas, colunas). O layout fica salvo por conta (sincroniza como o resto do app) e reaplica em uploads futuros.
- **"Usar este orçamento no app"** (novo): depois de ler a planilha, um cartão deixa escolher o mês (do app) em que aplicar o Previsto lido e grava isso de verdade (`Api.importCategoryBudgets` em `js/api.js`). No plano **Free**, esse passo inclui **3 importações/dia** por usuário; a partir da 4ª no mesmo dia, cada importação adicional custa **R$ 10,00** via Pix. No **Premium**, é ilimitado sem cobrança adicional. É esse passo que conecta a planilha ao restante do fluxo; sem ele, a leitura continua sendo só uma prévia pontual, como antes.
- Existe uma versão equivalente em linha de comando para quem administra a planilha de orçamento fora do navegador — ver `orcamento_agent/LEIA-ME.md` (`--criar-layout`/`--ler-orcamento` do `mp_sync.py`). É um projeto separado (agente de orçamento do casamento), documentado por conta própria; o layout de leitura é o único conceito compartilhado com este app.

Código: `js/dashboard.js` (`loadBudgetView`, `handleBudgetFileUpload`, `showBudgetAdoptCard`, `handleBudgetAdopt`), `js/budget-ai.js`, `Api.importCategoryBudgets` em `js/api.js`.
</details>

<details>
<summary><strong>Página 2 — Registrar Despesas</strong></summary>

Registra despesas com valor, data, categoria e descrição — igual a antes, com um adicional: ao escolher a categoria, um aviso mostra o Previsto x Realizado **daquela categoria no mês atual**, puxado do que foi importado na Página 1 (`Api.getBudgetOverview`), inclusive avisando quando a categoria ainda não tem orçamento definido.

- A página usa o **SpaceHub - Chatbot de Financiamento (sem token)** para gerar despesas e importar direto em "Minhas despesas". O campo "Usuário GitHub" é opcional e só adiciona contexto usando APIs públicas do GitHub; o chatbot também expõe uma API interna de metodologias da linguagem portuguesa (verbos, adjetivos, provérbios e orações subordinadas) e executa o fluxo por uma VM interna de instruções (`ChatbotVirtualMachine` em `js/google-ai-chatbot.js`).
- **Regras automáticas de categoria**: ficam em menu próprio na sidebar, mantendo a mesma lógica (`Api.addExpenseRule`, `Api.applyExpenseRulesToUncategorized`).
- O limite diário do plano é checado a cada envio (`Api.getExpenseQuota()`). O plano Free tem 6 despesas/dia — da 7ª em diante abre o modal de pagamento Pix (ver [💳 Plano](#-plano)) antes de salvar.
- Categorias são criadas na mesma tela (`category-form`) e ficam por conta (tenant) — inclusive as criadas automaticamente ao importar um orçamento na Página 1 ou ao gerar despesas via Mercado Pago (ver abaixo).
- Excluir uma despesa (botão "Excluir" na tabela) não devolve cota do dia, mas atualiza o Realizado mostrado na hora (aqui e na Página 3).
- Despesas com o selo **Mercado Pago (API)** na tabela não foram digitadas por ninguém — foram geradas automaticamente a partir de um pagamento real no Mercado Pago via API (`orcamento_agent/mp_expenses.py`, com Access Token, fora do navegador) — e não contam para o limite diário do plano Free (é importação de histórico, não uma ação em tempo real do usuário). Ver [Mercado Pago: confirmação automática de pagamentos](#mercado-pago-confirmação-automática-de-pagamentos).
- Além do selo por linha, a **sidebar do painel** (todas as telas, não só esta) mostra um badge **Mercado Pago** único e sempre visível, logo abaixo do indicador de sincronização: resume quantas despesas foram geradas e quantos pagamentos foram confirmados via Mercado Pago, com a data da atualização mais recente (tudo por conta/tenant). Cinza/apagado quando nenhum dado do Mercado Pago chegou ainda; colorido quando há pelo menos uma despesa gerada ou um pagamento confirmado. Ver `MercadoPagoStatusIndicator`/`Api.getMercadoPagoStatus()` abaixo.

Código: `js/dashboard.js` (`_loadExpensesView`, `_refreshExpenseCategoryBudgetInfo`, `_refreshQuotaInfo`, `_refreshExpenseTable`, `_setupGoogleAIChatbot`, `MercadoPagoStatusIndicator`), `js/google-ai-chatbot.js`, lógica de negócio em `js/api.js` (`addExpense`, `getMercadoPagoStatus`).
</details>

<details>
<summary><strong>Página 3 — Alertas / Orçamento</strong></summary>

Duas comparações independentes, uma embaixo da outra:

- **Limite geral do mês (como antes):** um único valor total por mês, sem categoria (`budget-form`) — mostra se o total de despesas do mês já passou desse limite (`alerts-box`).
- **Previsto x Realizado por categoria (novo):** tabela com um seletor de mês, cruzando o Previsto importado na **Página 1** com o Realizado somado das despesas reais da **Página 2** (`Api.getBudgetOverview`) — a conta inteira, não só o usuário logado. Cada categoria fica com um destes selos: <span title="previsto e dentro do limite">DENTRO DO ORÇAMENTO</span>, <span title="realizado maior que o previsto">ESTOURADO</span>, ou <span title="tem despesa no mês mas nenhum Previsto foi importado para ela">SEM ORÇAMENTO</span> — este último existe de propósito, para nunca fingir que uma categoria sem orçamento definido está "dentro do previsto".

Código: `js/dashboard.js` (`loadAlertsView`, `loadBudgetOverview`), `Api.setBudget`/`Api.getAlerts`/`Api.getBudgetOverview` em `js/api.js`.
</details>

### 📊 Relatório

<details>
<summary>O que é e como funciona</summary>

A seção **Relatório** agora é paginada por tipo de relatório:

1. **Indicadores**: consumo de orçamento, alerta preditivo e checklist de fechamento mensal.
2. **Gráficos**: gasto total por mês (barras) e gasto por categoria (rosca).
3. **Origem das transações (Agente IA)**: classifica cada transação por tipo e origem detectada, com detalhamento.
4. **Exportação**: relatório consolidado em CSV, Excel e PDF.

Além dos gráficos, a tela inclui:

- **Alerta preditivo do mês**: projeção simples de gasto até o fim do mês com base na média diária (`Api.getMonthlyProjection`).
- **Checklist de fechamento mensal**: itens guiados para fechar o mês (categorização, comprovantes, limite mensal e orçamento por categoria) (`Api.getMonthlyCloseChecklist`).
- **Agente IA de origem de transações**: identifica de onde cada tipo de transação ocorreu (`Api.getTransactionOriginReport`).
- **Exportação consolidada**: relatório de despesas + orçamento em CSV, Excel e PDF (`Api.getConsolidatedExportData` + exportadores no `dashboard.js`).

Código: `js/dashboard.js` (`loadReportsView`), dados vindos de `Api.monthlyReport()`/`Api.categoryReport()` em `js/api.js`.
</details>

### 📰 Feed

<details>
<summary>O que é e como funciona</summary>

Uma visão cronológica das últimas movimentações da conta no painel, juntando:

- **Despesas** registradas no sistema
- **Pagamentos** confirmados no histórico do plano

O feed ordena os eventos do mais recente para o mais antigo e pode ser atualizado manualmente pelo botão **Atualizar**.

Código: `dashboard.html` (`view-feed`), `js/dashboard.js` (`_loadFeedView`) e `Api.listExpenses()`/`Api.listPayments()` em `js/api.js`.
</details>

### 👥 Equipe

<details>
<summary>O que é e como funciona</summary>

Só para `admin`. Convida usuários (nome, e-mail, senha inicial, papel Membro/Administrador) e lista quem já está na conta. Sem servidor, o convite só cria o usuário direto no banco (Firestore/localStorage) — não há envio de e-mail real.

Código: `js/dashboard.js` (`loadTeamView`), `Api.listUsers()`/`Api.inviteUser()` em `js/api.js`.
</details>

### 💳 Plano

<details>
<summary>O que é e como funciona</summary>

Mostra os dois planos e o histórico de pagamentos.

| Plano | Preço | Despesas/dia |
|---|---|---|
| Free | R$ 0,00 | 3 (cada despesa extra: cobrança real de R$ 5,00/unidade via Pix) |
| Premium | R$ 19,99/mês | Ilimitadas |

Trocar de plano (ou pagar a despesa extra) abre o **modal de Pix real**: QR Code + "copia e cola" válidos no formato do Banco Central (BR Code, CRC16), apontando pra chave Pix real da SPACECWORP (CNPJ 62.904.267/0001-60). Quem escanear/pagar transfere dinheiro de verdade.

Depois de pagar, o usuário envia o comprovante e cada pagamento pode ganhar até dois selos independentes no histórico:
- **✓ comprovante validado por IA** — OCR local (`js/receipt-ai.js`, Tesseract.js) leu o comprovante enviado na hora e confirmou valor + recebedor.
- **✓ verificado via Mercado Pago** — um agente local (fora do navegador) cruzou o pagamento com a API do Mercado Pago depois do fato. Ver a próxima seção.

Se nenhum dos dois bater, o pagamento fica com **⚠ confirmação manual** — o usuário declarou que pagou, mas nada confirmou automaticamente ainda.

Código: `js/dashboard.js` (`loadPlanView`, `selectPlan`, `openPixPayment`, `renderPaymentsHistory`), `js/pix.js` (payload BR Code), `js/plans.js` (regras dos planos), `Api.addPayment`/`Api.listPayments`/`Api.changePlan` em `js/api.js`.
</details>

### 🔎 Verificação de transação Mercado Pago

<details>
<summary>O que é e como funciona</summary>

Tela para conferir um ID de transação do Mercado Pago e descobrir se ele já aparece:

- em despesas importadas automaticamente (integração Mercado Pago),
- em pagamentos salvos na conta (inclusive os já verificados pelo Mercado Pago),
- em rejeições recentes da automação (`verificacoes_rejeitadas`).

Código: `dashboard.html` (`view-mp-transaction-check`), `js/dashboard.js` (`_loadMercadoPagoTransactionCheckView`, `_renderMercadoPagoTransactionCheckResult`) e `Api.verifyMercadoPagoTransactionId` em `js/api.js`.
</details>

### 🔒 Segurança e Privacidade (LGPD)

<details>
<summary>O que é e como funciona</summary>

A tela agora é paginada em 2 páginas dentro do mesmo menu: **Página 1 (Segurança)** e **Página 2 (Privacidade)**, com botões "Anterior/Próxima" e atalhos diretos.

Na Página 1, há status da sessão OAuth atual (token, validade, escopo), lista dos controles de segurança realmente implementados (hash PBKDF2, OAuth 2.0 próprio com PKCE, bloqueio após tentativas de login erradas, política de transporte seguro para o fluxo OAuth, rastreabilidade local de eventos OAuth, CSP, isolamento por conta), modelo CIA Triad e tabela de ameaças, além das normas ISO usadas como referência de boas práticas.
</details>

<details>
<summary>Página 2 — Privacidade (LGPD)</summary>

Identifica o controlador dos dados (dados da empresa, extraídos do CNPJ/CMC/Alvará), lista o que é coletado e a base legal (LGPD, Lei 13.709/2018), controla o consentimento de cookies de analytics/anúncios via **Google Consent Mode v2** (bloqueado por padrão, `gtag('consent', 'default', {...denied})` no `<head>` de `login.html`/`dashboard.html`, antes de qualquer script do Google carregar), lista os direitos do titular (art. 18) e oferece duas ações reais: **baixar meus dados** (exporta um JSON com tudo que a conta tem no sistema) e **excluir minha conta** (remove o usuário e, se for o único da conta, a conta inteira).

Código: `js/dashboard.js` (`_loadSecurityPrivacyView`, `_goToSecurityPrivacyPage`, `_loadSecurityView`, `_loadPrivacyView`, getters estáticos `SECURITY_CONTROLS`/`CIA_TRIAD`/`SECURITY_THREATS`/`ISO_STANDARDS`), `Api.getPrivacyConsent`/`setPrivacyConsent`/`exportMyData`/`deleteAccount` em `js/api.js`, e `js/oauth.js` (ver seção própria abaixo).
</details>

### ⚙️ Configurações

<details>
<summary>O que é e como funciona</summary>

Editar nome e trocar senha (com verificação da senha atual). Um campo de **CPF/CNPJ** guarda o documento fiscal do usuário — é o dado do "tomador" exigido para emitir uma Nota Fiscal de Serviço (NFS-e) real (ver [Nota Fiscal (NFS-e)](#nota-fiscal-nfs-e-emissão-real-via-focus-nfe) abaixo); sem ele, a emissão fica pendente. Também mostra os dados institucionais fixos da empresa (razão social, CNPJ, CNAE, endereço, validade do Alvará de Funcionamento) extraídos do cadastro na Prefeitura de Osasco/SP.

Código: `js/dashboard.js` (`_loadSettingsView`, `_handleProfileFormSubmit`, `_handlePasswordFormSubmit`), `Api.updateProfile`/`Api.changePassword`/`Api.getCompanyProfile` em `js/api.js` (`COMPANY_PROFILE`).
</details>

---

## Mercado Pago: confirmação automática de pagamentos

O site é 100% estático (GitHub Pages) — o Access Token do Mercado Pago **nunca** pode ir para o navegador. Por isso a cobrança em si continua sendo um Pix estático real (ver [💳 Plano](#-plano) acima), e a confirmação automática roda como um **agente local separado**, que só existe fora do site publicado:

> Quer só **ver** as atividades reais da conta antes de configurar tudo? `orcamento_agent/mp_list_activities.py` lista/exporta os pagamentos do Mercado Pago (data, valor, status, descrição) direto no terminal — só o Access Token, sem Firebase e sem gravar nada. Ver `orcamento_agent/LEIA-ME.md` → "Ver as atividades do Mercado Pago sem gerar despesas".

**`orcamento_agent/mp_reconcile.py`** busca pagamentos aprovados de verdade na API do Mercado Pago (mesma conta da chave Pix usada no modal) e cruza por **valor + data** com o histórico de pagamentos já gravado pelo app (lendo/gravando o mesmo Firestore que o painel usa, ou uma cópia local do banco). Pagamentos que baterem com clareza passam a ter o selo "✓ verificado via Mercado Pago" no histórico — sem o usuário precisar fazer nada. Quando duas transações reais têm o mesmo valor na mesma janela de dias, o pagamento fica marcado como **ambíguo** e não é confirmado automaticamente, para não arriscar confirmar o errado.

<details>
<summary>Como configurar e rodar</summary>

1. `cd orcamento_agent`
2. Copie `mp_reconcile_config.example.json` → `mp_reconcile_config.json` e cole o Access Token do Mercado Pago (developers.mercadopago.com.br → Suas integrações → Credenciais).
3. Escolha **uma** fonte de dados no `mp_reconcile_config.json`:
   - `firebase_service_account`: caminho de uma chave de conta de serviço do Firebase (recomendado — é o mesmo banco que o painel usa). Gere em Console do Firebase → Configurações do projeto → Contas de serviço → Gerar nova chave privada.
   - `db_json`: caminho de uma cópia local do banco (alternativa sem Firebase).
4. `pip install requests openpyxl --break-system-packages` (e `pip install firebase-admin --break-system-packages` se for usar Firestore).
5. Rode:
   ```bash
   python3 mp_reconcile.py --dry-run     # mostra o que faria, sem gravar nada
   python3 mp_reconcile.py               # reconcilia de verdade (últimos 30 dias)
   ```
6. Depois de qualquer alteração no script: `python3 test_mp_reconcile.py` (dados simulados, não chama a API real).

Pode ser agendado (ex.: uma vez por dia) do mesmo jeito que `mp_sync.py` já é — basta pedir para configurar o agendamento.
</details>

<details>
<summary>⚠️ Segurança e limitações — leia antes de usar</summary>

- O Access Token do Mercado Pago e uma eventual chave de conta de serviço do Firebase são **segredos reais**: dão acesso à conta de pagamentos e ao banco completo do app, respectivamente. `mp_reconcile_config.json` e qualquer `*serviceAccount*.json` já estão no `.gitignore` — confirme com `git status` antes do primeiro commit.
- **Não é um webhook em tempo real.** A confirmação só acontece quando alguém roda o script (manual ou agendado) — não é instantânea como um checkout de verdade seria.
- **Correspondência por valor + data, não por identificador exato.** Um Pix pago para uma chave estática não carrega nenhum dado do app até chegar no Mercado Pago — por isso o cruzamento é best-effort (mesmo espírito da IA de OCR do comprovante, só que usando dados reais do Mercado Pago em vez de ler uma imagem).
- Isso **não substitui** um checkout de verdade (Payment Brick/Preferences do Mercado Pago com webhook). Isso exigiria criar e hospedar um backend/serverless só para guardar o Access Token com segurança — fora do escopo 100% front-end estático deste projeto hoje (ver [Roadmap](#roadmap)).
- `orcamento_agent/` também guarda `mp_sync.py`, um agente **sem relação com este app** que sincroniza uma planilha de orçamento pessoal (ex.: casamento) com o Mercado Pago — documentado à parte em `orcamento_agent/LEIA-ME.md`.
</details>

### Gerar despesas automaticamente (`mp_expenses.py`)

O `mp_reconcile.py` acima confirma dinheiro **entrando** na conta (assinatura/despesa extra pagas por usuários do painel). O **`orcamento_agent/mp_expenses.py`** faz o caminho inverso: usa os mesmos pagamentos reais do Mercado Pago para gerar despesas de verdade na [Página 2](#-orçamento--despesas-fluxo-em-3-páginas) — fechando o fluxo Orçamento & Despesas sem digitar nada. Cada pagamento aprovado é categorizado por palavra-chave (config `mapeamento`) e vira uma despesa real, exceto os que já são receita da conta (excluídos com precisão via `mp_reconcile.py`, e por reforço via filtro de descrição).

<details>
<summary>Como configurar e rodar</summary>

1. `cd orcamento_agent`
2. Copie `mp_expenses_config.example.json` → `mp_expenses_config.json`, cole o Access Token do Mercado Pago e preencha `"conta_email"` (o e-mail de login da conta do painel que vai receber as despesas — precisa já existir).
3. Escolha a mesma fonte de dados de `mp_reconcile.py` (`firebase_service_account` ou `db_json`) e ajuste `mapeamento`/`categoria_padrao` como preferir.
4. Rode **sempre nesta ordem** (a primeira execução marca o que é receita, para a segunda não confundir com despesa):
   ```bash
   python3 mp_reconcile.py
   python3 mp_expenses.py --dry-run     # mostra o que geraria, sem gravar nada
   python3 mp_expenses.py               # gera as despesas de verdade
   ```
5. Depois de qualquer alteração no script: `python3 test_mp_expenses.py`.

No painel web, despesas geradas assim aparecem na Página 2 com o selo **Mercado Pago** (ver acima) e também entram na contagem do badge **Mercado Pago** da sidebar (visível em qualquer tela do painel). Cada uma guarda o id do pagamento de origem — rodar de novo nunca duplica.
</details>

<details>
<summary>⚠️ Segurança e limitações — leia antes de usar</summary>

- Mesmos segredos e mesmos cuidados de `.gitignore` do `mp_reconcile.py` acima (`mp_expenses_config.json` nunca deve ser versionado).
- **Depende de rodar `mp_reconcile.py` primeiro** para excluir com precisão o que é receita da conta; sem isso, só o filtro de descrição (`ignorar_descricoes_contendo`) protege contra lançar uma cobrança recebida como se fosse despesa.
- Categorização por palavra-chave é heurística — pagamentos sem regra correspondente caem numa categoria padrão e precisam ser recategorizados manualmente (hoje não há como editar a categoria de uma despesa já lançada pelo painel, só excluir e lançar de novo).
- Não roda em tempo real: só gera despesas quando alguém executa o script (manual ou agendado).
</details>

### Sincronizar cartão via Open Finance + deploy MP (`mp_open_finance_sync.py`)

Para o cenário de cartão, o **`orcamento_agent/mp_open_finance_sync.py`** sincroniza dados de cartão/transações vindos de um provedor Open Finance (OAuth) e, opcionalmente, do endpoint de deploy do Mercado Pago. A gravação é idempotente (upsert por `externalCardId`/`externalTransactionId`) e pode projetar compras aprovadas como despesas reais no painel.

**Regra crítica de compliance (PCI DSS):** o agente **remove CVV/CVC/security_code por design** antes de qualquer persistência. Se vier PAN completo, só `last4` é preservado.

<details>
<summary>Como configurar e rodar</summary>

```bash
cd orcamento_agent
cp mp_open_finance_config.example.json mp_open_finance_config.json
python3 mp_open_finance_sync.py --dry-run
python3 mp_open_finance_sync.py
python3 mp_open_finance_sync.py --modo webhook --payload evento_open_finance.json
python3 test_mp_open_finance_sync.py
```

No config (`mp_open_finance_config.json`): preencha OAuth Open Finance (`open_finance_token_endpoint`, `open_finance_client_id`, `open_finance_client_secret`), `conta_email` da conta do painel, e a fonte de dados (`firebase_service_account` recomendado, ou `db_json`).
</details>

### Ver as atividades da conta (`mp_list_activities.py`)

Antes de gerar despesas de verdade, às vezes é útil só **espiar o que existe na conta do Mercado Pago**: quantos pagamentos, valores, status. O **`orcamento_agent/mp_list_activities.py`** faz exatamente isso — busca as atividades (pagamentos) reais dos últimos N dias direto da API do Mercado Pago usando o mesmo Access Token dos outros agentes, sem precisar do Firebase nem de nenhuma cópia do banco do painel. É só leitura: nunca grava nada no painel web nem no Mercado Pago.

<details>
<summary>Como rodar</summary>

```bash
cd orcamento_agent
python3 mp_list_activities.py                          # últimos 30 dias, usa config.json (ou outro já existente)
python3 mp_list_activities.py --dias 90
python3 mp_list_activities.py --status approved         # só um status
python3 mp_list_activities.py --config mp_expenses_config.json
python3 mp_list_activities.py --export atividades.csv   # também salva um CSV (ou .json, pela extensão)
```

Reaproveita o mesmo Access Token já configurado em `config.json`, `mp_reconcile_config.json` ou `mp_expenses_config.json`. Depois de qualquer alteração no script: `python3 test_mp_list_activities.py`.
</details>

### Automatizando de verdade: GitHub Actions

Os agentes de sincronização (`mp_reconcile.py`, `mp_expenses.py` e opcionalmente `mp_open_finance_sync.py`) podem rodar **sozinhos, sem depender do seu computador ligado**, via `.github/workflows/mercado-pago-sync.yml` — um workflow do GitHub Actions agendado (diário, ajustável) que roda num runner temporário do GitHub, lendo os segredos (Access Token, e-mail da conta, chave do Firebase e, para Open Finance, credenciais OAuth) de **Secrets** do repositório (Settings → Secrets and variables → Actions) — nunca do código, nunca do navegador. Pode também ser disparado manualmente em Actions → "Mercado Pago — sincronização automática" → Run workflow. Os nomes dos Secrets esperados estão documentados nos comentários do próprio arquivo do workflow.

<details>
<summary>⚠️ Segurança — leia antes de usar</summary>

- Os Secrets do GitHub Actions são visíveis/editáveis só por quem tem acesso de administração ao repositório — mesmo cuidado de qualquer outro segredo do projeto (revogue e gere um novo Access Token em developers.mercadopago.com.br se desconfiar de vazamento).
- O workflow apaga os arquivos de configuração temporários (com o token/chave) ao final de cada execução (`if: always()`), mesmo se algum passo anterior falhar.
- Continua valendo tudo o que já foi dito sobre cada script individualmente (idempotência, best-effort da correspondência valor+data, etc.) — o GitHub Actions só troca "quem aperta o botão" por um agendamento, a lógica é exatamente a mesma.
</details>

---

## Nota Fiscal (NFS-e): emissão real via Focus NFe

Assim como o Access Token do Mercado Pago, um token que emite notas fiscais em nome da empresa **nunca** pode ir para o navegador/site público. Por isso a emissão roda como mais um **agente local separado**, no mesmo espírito de `mp_reconcile.py`:

**`orcamento_agent/nfse_issuer.py`** procura, no histórico de pagamentos do painel (assinaturas de plano, despesas extras pagas via Pix), os que ainda não têm nota fiscal emitida, e chama a API real da [Focus NFe](https://focusnfe.com.br/) (referência escolhida — bem estabelecida no mercado brasileiro; teste grátis de 30 dias, sem cartão) para emitir uma **NFS-e de verdade**, gravando de volta no pagamento o número da nota, o link do PDF/XML e o status.

<details>
<summary>⚠️ O que isto NÃO faz sozinho — leia antes de configurar</summary>

- **Não emite nada sem você contratar uma conta real na Focus NFe** (ou reescrever `FocusNfeClient` para outro provedor) e configurar um token real em `nfse_config.json`. Sem isso, o script só recusa rodar com uma mensagem clara.
- **Não emite nada sem um certificado digital e-CNPJ (A1)** cadastrado no provedor — é ele quem assina a nota digitalmente; este script não guarda nem manipula certificados.
- **Não calcula tributos nem confirma seu enquadramento fiscal** (regime tributário, alíquota de ISS, código de serviço da Prefeitura de Osasco/SP) — os campos ficam em `nfse_config.json` como placeholders (`AJUSTAR_CONFORME_...`) até você preencher com seu contador.
- **Não inventa dados do cliente.** Só emite para pagamentos cujo usuário já cadastrou CPF/CNPJ em [⚙️ Configurações](#️-configurações) — os demais ficam com `nfseStatus: "aguardando_documento_tomador"`, visível no histórico de pagamentos do painel.
- **Sempre rode primeiro com `"ambiente": "homologacao"`** (padrão do `nfse_config.example.json`) — simula a emissão sem gerar nota real e sem custo, até você validar o fluxo inteiro.
- Os nomes de campos/endpoints da Focus NFe usados aqui seguem o formato público e documentado da API, mas provedores de emissão fiscal atualizam detalhes com alguma frequência (ex.: adesão de municípios à NFS-e Nacional) — **confirme em [doc.focusnfe.com.br](https://doc.focusnfe.com.br) antes de rodar em produção.**
</details>

<details>
<summary>Como configurar e rodar</summary>

1. `cd orcamento_agent`
2. Copie `nfse_config.example.json` → `nfse_config.json`.
3. Crie uma conta em [focusnfe.com.br](https://focusnfe.com.br/precos/) (30 dias grátis) e cole o token de **homologação** em `focus_nfe_token`.
4. Preencha `prestador`/`servico` em `nfse_config.json` com seu contador (regime tributário, alíquota, código de serviço de Osasco/SP — `codigo_municipio` já vem preenchido: `3534401`).
5. Escolha **uma** fonte de dados (`firebase_service_account` ou `db_json`), mesma ideia de `mp_reconcile.py`.
6. `pip install requests --break-system-packages` (e `firebase-admin` se for usar Firestore).
7. Peça para cada usuário cadastrar CPF/CNPJ em [⚙️ Configurações](#️-configurações) no painel.
8. Rode:
   ```bash
   python3 nfse_issuer.py --dry-run     # mostra o que emitiria, sem chamar a API nem gravar
   python3 nfse_issuer.py               # emite de verdade (ambiente definido no config)
   ```
9. Só depois de validar tudo em homologação, troque `"ambiente"` para `"producao"` no config (token de produção é diferente do de homologação).

Pode ser agendado do mesmo jeito que `mp_reconcile.py` (GitHub Actions ou cron local).
</details>

---

## Como o sistema funciona por baixo dos panos

<details>
<summary><strong>Arquitetura de arquivos</strong></summary>

```
index.html            -> landing page (marketing, planos, FAQ)
login.html             -> login / criação de conta
dashboard.html         -> painel principal (SPA simples, ver seções acima)
db.json                 -> banco "de fábrica" (schema vazio), usado só para
                            inicializar a 1ª visita de cada navegador
css/styles.css          -> estilos do login e do painel
css/landing.css         -> estilos da landing page
js/
  firebase-config.js    -> configuração e inicialização do Firebase (Firestore)
  plans.js             -> planos (free / premium) e limites
  db.js                 -> "banco de dados": Firestore (primário, se configurado)
                            > localStorage (fallback/cache offline) > db.json
                            (1ª visita) > schema vazio
  crypto-utils.js       -> hash de senha (PBKDF2 + SHA-256 via Web Crypto)
  oauth.js               -> OAuth 2.0 próprio (Authorization Code + PKCE, RFC
                            6749/7636), tokens JWT (HS256), refresh/revogação,
                            bloqueio de login por força bruta (ver "Autenticação")
  api.js                 -> toda a lógica de negócio (antes no FastAPI), mesma
                            interface de antes (Auth/Api), agora sem servidor próprio
  auth-page.js           -> lógica de login/signup (login.html)
  dashboard.js           -> lógica do painel (despesas, relatórios, alertas, equipe, plano)
  pix.js                  -> geração de QR Code / Pix Copia e Cola (BR Code real)
  receipt-ai.js           -> "IA" (OCR local, Tesseract.js) que lê o comprovante do
                              Pix e confere valor/recebedor automaticamente
  budget-ai.js            -> leitura client-side de planilhas de orçamento (ver
                              "🔄 Orçamento & Despesas" -> Página 1)
tests/
  firebase-sync.test.js  -> teste de integração (Node) da sincronização com o
                            Firebase — migração, multi-dispositivo, fallback
                            offline e reconciliação (ver "Testes automatizados")
  budget-flow.test.js    -> teste de integração (Node) do fluxo Orçamento &
                            Despesas — Previsto importado x Realizado real,
                            categorias sem orçamento, reimportação idempotente
  mercado-pago-badge.test.js -> teste de integração (Node) do badge Mercado
                            Pago da sidebar (Api.getMercadoPagoStatus) —
                            conectado/desconectado, isolamento por conta
  performance-smoke.test.js -> smoke test de performance local para apoiar
                            métricas da ISO/IEC 25010 (cadastro/login, lote
                            de despesas e visão de orçamento)
orcamento_agent/
  mp_reconcile.py        -> confirma automaticamente pagamentos do painel web
                            cruzando com o Mercado Pago (ver seção própria acima)
  mp_expenses.py          -> gera despesas reais na Página 2 a partir de
                            pagamentos do Mercado Pago via API (ver seção própria acima)
  mp_list_activities.py   -> lista as atividades (pagamentos) reais da conta via
                            Access Token, só leitura, sem Firebase (ver seção própria acima)
  nfse_issuer.py          -> emite Nota Fiscal de Serviço (NFS-e) real via Focus
                            NFe para pagamentos do painel (ver seção própria acima)
  mp_sync.py, ...        -> agente separado para planilha de orçamento pessoal,
                            sem relação com este app (ver orcamento_agent/LEIA-ME.md)
.github/workflows/
  mercado-pago-sync.yml  -> roda mp_reconcile.py/mp_expenses.py
                            sozinho (agendado ou manual), com os segredos vindos de
                            Secrets do repositório -- ver seção "Automatizando de
                            verdade" acima
  test-deploy.yml        -> valida secrets de teste e roda testes Node/Python
                            da integração Mercado Pago em execução manual/agendada
```

Não há mais pasta `backend/`, `app.py`, `models/`, `services/` ou `utils/` em Python — o painel web em si é só front-end estático (o `orcamento_agent/` é uma automação local opcional, fora do site publicado).
</details>

<details>
<summary><strong>Persistência (Firebase/Firestore + fallback em localStorage)</strong></summary>

O banco de dados primário é o **Firebase (Cloud Firestore)**. Todo o "banco" (tenants, usuários, categorias, despesas, orçamentos gerais, **Previsto por categoria** — `categoryBudgets`, alimentado pela Página 1 do fluxo [🔄 Orçamento & Despesas](#-orçamento--despesas-fluxo-em-3-páginas) —, pagamentos, layouts de leitura) é salvo como um único documento no Firestore (`fintech_saas/db_v1`) — mesmo formato que já era usado no `db.json`/`localStorage`. Regras, em `js/db.js`:

- **Leitura (`loadDb()`):**
  1. Se o Firebase está configurado (`js/firebase-config.js`) e alcançável, lê o documento do Firestore. Se existir, esse é o dado usado (e uma cópia é guardada no `localStorage` como cache).
  2. Se o documento ainda não existir no Firestore (primeiro uso), o app usa o que tiver no `localStorage` ou, na falta disso, busca o banco de fábrica `db.json` via `fetch()` — e envia esse conteúdo para o Firestore, "adotando-o" como ponto de partida.
  3. Se o Firebase **não** estiver configurado, o SDK não carregar, o navegador estiver offline, ou a chamada falhar por qualquer motivo, o app cai automaticamente para o fluxo antigo: `localStorage` (se já tiver algo salvo) → `db.json` (1ª visita) → schema vazio.
- **Gravação (`saveDb()`):** toda gravação (nova despesa, novo usuário, troca de plano, pagamento etc.) grava **primeiro no `localStorage`** — rápido, síncrono na prática, nunca depende de rede — e a função retorna imediatamente, sem esperar a rede. O envio ao Firestore roda **em segundo plano**, numa fila que preserva a ordem das gravações. Se a sincronização falhar, fica marcada como **pendente** e é reenviada automaticamente assim que a conexão volta, a cada 20s enquanto houver pendência, ou na próxima operação de leitura/gravação.

O app **nunca trava esperando rede** e nunca perde dados por falta de Firebase — o `localStorage` é sempre a rede de segurança. Veja [Conectando ao Firebase](#conectando-ao-firebase) para o passo a passo de configuração.

`orcamento_agent/mp_reconcile.py` (ver [seção acima](#mercado-pago-confirmação-automática-de-pagamentos)) é o único código fora do navegador que também lê/grava neste mesmo documento Firestore — usando uma chave de conta de serviço própria, nunca a `apiKey` pública do site.
</details>

<details>
<summary><strong>Multi-tenancy</strong></summary>

Cada conta que se cadastra vira um "tenant" isolado dentro do mesmo banco (Firestore e/ou `localStorage`). Todo dado (usuários, categorias, despesas, orçamentos, pagamentos) é filtrado por `tenant_id` na camada `api.js`.

**Importante:** esse isolamento é apenas lógico/organizacional — não é uma fronteira de segurança real, com ou sem Firebase. Sem Firebase, qualquer pessoa com acesso ao navegador (DevTools) pode ler ou editar o `localStorage` diretamente. Com Firebase configurado usando as regras de teste (abertas) descritas em [Conectando ao Firebase](#conectando-ao-firebase), qualquer pessoa que descubra as credenciais públicas do projeto Firebase (`apiKey` etc., visíveis no código-fonte do site) também consegue ler/escrever o documento no Firestore diretamente. Isso é adequado para demo, protótipo ou uso pessoal, mas **não deve ser usado como um SaaS multi-conta real na internet** sem regras de segurança do Firestore mais restritivas e, idealmente, Firebase Authentication de verdade (ver [Roadmap](#roadmap)).
</details>

<details>
<summary><strong>Planos e cobrança via Pix — detalhes</strong></summary>

O sistema só pode ser usado com login (a tela `dashboard.html` redireciona para `login.html` se não houver sessão ativa). Depois de logado, todo usuário tem acesso completo ao sistema — a única diferença entre os planos é o limite diário de despesas (tabela em [💳 Plano](#-plano)).

O limite é checado em `js/api.js` (`addExpense`) ao criar cada despesa: ao atingir 3 despesas no dia, a despesa não é salva imediatamente — abre-se um QR Code Pix real (mesma chave usada no site, CNPJ 62.904.267/0001-60) de R$ 5,00. O usuário paga no app do próprio banco e envia o comprovante; uma IA local (OCR, `js/receipt-ai.js`) confere se o valor e o recebedor batem com a cobrança antes de habilitar a confirmação — se a leitura automática falhar, ainda é possível confirmar manualmente. Trocar para o plano Premium funciona do mesmo jeito, com um QR Code Pix de R$ 19,99/mês.

**Importante sobre o Pix:** o QR Code e o código "copia e cola" são gerados no formato oficial do Banco Central (BR Code, com CRC16) e apontam para uma chave Pix real — ou seja, quem pagar transfere dinheiro de verdade. A confirmação em "Já paguei" é uma declaração do próprio usuário; o que a valida de fato depois é a IA de OCR (na hora) e/ou o agente `mp_reconcile.py` (depois do fato, ver [Mercado Pago: confirmação automática de pagamentos](#mercado-pago-confirmação-automática-de-pagamentos)) — nenhum dos dois é um webhook bancário em tempo real.
</details>

<details>
<summary><strong>"Autenticação" — OAuth 2.0 próprio (Authorization Code + PKCE)</strong></summary>

Login e cadastro emitem tokens através de um fluxo OAuth 2.0 implementado do zero em `js/oauth.js` — Authorization Code Grant + PKCE (RFC 6749 + RFC 7636), do mesmo jeito que um provedor OAuth de verdade faria, só que rodando 100% no navegador (não é "Entrar com o Google"; é o próprio app fazendo as duas pontas, já que não há backend):

- **Tokens JWT (HS256):** `access_token` (1h) e `refresh_token` (30 dias), assinados com HMAC-SHA256. A chave de assinatura é gerada uma vez por instalação do navegador (Web Crypto, 256 bits) e guardada em `localStorage` — não é um segredo fixo no código-fonte.
- **PKCE de verdade:** `code_verifier`/`code_challenge` (S256) amarram o authorization code (de uso único, TTL de 60s) a quem o pediu.
- **Verificação criptográfica na entrada do painel:** `dashboard.html` reconfere a assinatura + expiração do `access_token` (`Auth.verifySession()`) antes de confiar na sessão, renovando automaticamente via `refresh_token` se necessário — em vez de só checar se existe algo no `localStorage`.
- **Revogação e rotação:** logout revoga os tokens atuais (`OAuth.revoke`); cada renovação via `refresh_token` rotaciona (revoga o antigo, emite um novo).
- **Bloqueio de força bruta:** 5 senhas erradas seguidas para o mesmo e-mail travam novas tentativas de login por 60s (`LoginRateLimiter`).

Senhas continuam com hash PBKDF2 (100.000 iterações, SHA-256, Web Crypto) — nunca texto puro. **De novo, o limite honesto:** sem backend, a chave de assinatura e o "banco de usuários" moram no mesmo navegador — isso é uma implementação correta do protocolo OAuth, não uma fronteira de segurança real contra quem tem acesso a este navegador/dispositivo (mesma ressalva de sempre neste projeto). Ver a tela [🔒 Segurança](#-segurança) no painel para o detalhe completo dos controles.
</details>

---

## Conectando ao Firebase

O app funciona sem Firebase (só com `localStorage`, como sempre funcionou). Para ativar a sincronização em nuvem (dados acessíveis de qualquer navegador/dispositivo) e habilitar o `mp_reconcile.py`, siga os passos abaixo.

<details open>
<summary><strong>Passo a passo completo</strong></summary>

### 1. Criar o projeto no Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com/) e faça login com uma conta Google.
2. Clique em **"Adicionar projeto"**, dê um nome (ex.: `fintech-spacecworp`) e siga o assistente (pode desativar o Google Analytics, não é necessário).
3. Aguarde a criação do projeto.

### 2. Criar o banco de dados Firestore

1. No menu lateral, vá em **Compilação (Build) → Firestore Database**.
2. Clique em **"Criar banco de dados"**.
3. Escolha uma localização (ex.: `southamerica-east1` para servidores no Brasil).
4. Em "Regras de segurança", comece em **modo de teste** (permite leitura/escrita por um período — depois ajuste as regras, ver passo 5). Confirme.

### 3. Registrar um app Web e pegar as credenciais

1. Na página inicial do projeto, clique no ícone **`</>`** ("Adicionar app" → Web).
2. Dê um apelido ao app (ex.: `fintech-web`) e clique em **"Registrar app"**. Não precisa configurar o Firebase Hosting.
3. O console mostra um bloco `firebaseConfig` parecido com:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "fintech-spacecworp.firebaseapp.com",
  projectId: "fintech-spacecworp",
  storageBucket: "fintech-spacecworp.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456",
};
```

4. Copie esses valores.

### 4. Colar as credenciais no projeto

Abra `js/firebase-config.js` e substitua os valores de exemplo pelos que você copiou. Salve o arquivo. O app detecta automaticamente que o Firebase está configurado (não precisa mudar mais nada em nenhum outro arquivo) e passa a usar o Firestore como banco primário, com `localStorage` como fallback.

### 5. Ajustar as regras de segurança do Firestore

O "modo de teste" do passo 2 expira sozinho depois de alguns dias e é aberto para qualquer leitura/escrita — não use em produção por muito tempo. Em **Firestore Database → Regras**, um ponto de partida razoável para este app (um único documento, sem Firebase Authentication) é restringir ao documento usado pelo app:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /fintech_saas/db_v1 {
      allow read, write: if true; // ver aviso abaixo
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**Aviso:** como este projeto não usa Firebase Authentication, não há como as regras do Firestore diferenciarem "seus" usuários de qualquer visitante — quem tiver a `apiKey` (pública, visível no código-fonte do site) consegue ler/escrever esse documento. Isso é aceitável para uso pessoal, demo ou protótipo (mesmo nível de segurança que o `localStorage` já tinha), mas **não é adequado para um SaaS real na internet** — para isso seria necessário adicionar Firebase Authentication e regras por usuário (ver [Roadmap](#roadmap)).

### 6. (Opcional) Gerar a chave de conta de serviço para o `mp_reconcile.py`

Só necessário se você quiser que o agente de reconciliação do Mercado Pago (ver [seção própria](#mercado-pago-confirmação-automática-de-pagamentos)) leia/grave direto no Firestore:

1. Console do Firebase → ⚙️ **Configurações do projeto → Contas de serviço**.
2. **Gerar nova chave privada** → baixa um `.json`.
3. Salve esse arquivo **fora do controle de versão** (ele já é coberto pelo `.gitignore` da raiz se ficar dentro de `orcamento_agent/` com "serviceAccount" ou "service-account" no nome) e informe o caminho em `orcamento_agent/mp_reconcile_config.json` (`firebase_service_account`).

### 7. Testar

1. Abra `login.html` (veja [Como rodar](#como-rodar)) e crie uma conta.
2. No console do Firebase, vá em **Firestore Database → Dados** e confirme que apareceu o documento `fintech_saas/db_v1` com os dados da conta criada.
3. Abra o app em outro navegador (ou aba anônima) e faça login com a mesma conta — os dados devem aparecer, confirmando a sincronização.
4. Para testar o fallback: desative sua conexão de internet, use o app normalmente (login já feito, adicionar despesas etc.) e reconecte — as mudanças feitas offline aparecem no Firestore automaticamente.
5. No painel (`dashboard.html`), a barra lateral mostra um indicador de status logo abaixo do plano: bolinha verde + "Sincronizado" (tudo certo com o Firebase), amarela + "Sincronizando…" (há mudanças locais aguardando conexão), ou cinza + "Modo local" (Firebase não configurado). Ele se atualiza sozinho a cada poucos segundos e também ao ficar online/offline.

</details>

---

## Como rodar

Não precisa instalar nada para o painel web. Duas opções:

**Opção 1 — abrir direto:** dê duplo clique em `index.html` (landing page) ou vá direto para `login.html`.

**Opção 2 — servidor estático local (recomendado):** alguns navegadores restringem certas APIs em `file://`. Se algo não funcionar ao abrir direto, sirva a pasta com qualquer servidor estático:

```bash
npx serve .
# ou, com Python já instalado apenas como utilitário de linha de comando:
python -m http.server 5500
```

Acesse `http://localhost:5500`.

## Primeiro uso

1. Abra `index.html` (ou `login.html` diretamente), clique em "Criar conta" e cadastre a primeira conta (você vira `admin` do tenant).
2. Em [🔄 Orçamento & Despesas](#-orçamento--despesas-fluxo-em-3-páginas): importe uma planilha (Página 1) ou registre categorias/despesas direto (Página 2), veja a área de [📊 Relatório](#-relatório) e confira os alertas (Página 3).
3. Como admin, convide outros usuários em [👥 Equipe](#-equipe) (respeitando o limite do plano) e experimente trocar de plano em [💳 Plano](#-plano).

## Testes automatizados

<details>
<summary><strong>Painel web — <code>tests/firebase-sync.test.js</code></strong></summary>

Executa `js/db.js`/`js/oauth.js`/`js/api.js` de verdade (sem modificar nada) contra um Firestore simulado (mesma interface `.collection().doc().get()/.set()` do SDK), cobrindo: migração automática do localStorage para o Firestore, leitura dos mesmos dados a partir de um segundo dispositivo, fallback quando o Firebase cai, e reconciliação (merge de 3 vias) ao reconectar sem apagar mudanças que outro dispositivo tenha sincronizado nesse meio tempo. Não precisa de projeto Firebase real nem de rede — só Node.js:

```bash
node tests/firebase-sync.test.js
```

Se o arquivo já tiver credenciais reais coladas em `js/firebase-config.js`, o teste as usa (só para simular a "ativação" do Firebase; nenhuma chamada de rede é feita de verdade). Rode de novo sempre que alterar `js/db.js` ou `js/api.js`.
</details>

<details>
<summary><strong>Fluxo Orçamento &amp; Despesas — <code>tests/budget-flow.test.js</code></strong></summary>

Executa `js/db.js`/`js/api.js` de verdade (sem Firebase, só `localStorage`) cobrindo o fluxo das 3 páginas: importar Previsto por categoria cria categorias novas e não duplica ao reimportar o mesmo mês; despesas reais (Página 2) se tornam o Realizado em `Api.getBudgetOverview` (não o Realizado da planilha); categoria com despesa mas sem Previsto fica `SEM_ORCAMENTO` em vez de um falso "dentro do orçamento"; categoria acima do Previsto fica `ESTOURADO`:

```bash
node tests/budget-flow.test.js
```

Rode de novo sempre que alterar `Api.importCategoryBudgets`/`Api.getBudgetOverview` (`js/api.js`) ou a coleção `categoryBudgets` (`js/db.js`).
</details>

<details>
<summary><strong>Badge Mercado Pago da sidebar — <code>tests/mercado-pago-badge.test.js</code></strong></summary>

Executa `js/db.js`/`js/api.js` de verdade (sem Firebase, só `localStorage`) simulando o que `mp_expenses.py`/`mp_reconcile.py` gravam de fora do navegador, e cobrindo `Api.getMercadoPagoStatus()` (dados que alimentam `MercadoPagoStatusIndicator` em `js/dashboard.js`): sem nenhum dado do Mercado Pago o resumo fica desligado; uma despesa lançada manualmente não conta; depois que uma despesa é marcada como gerada via Mercado Pago e um pagamento como confirmado via Mercado Pago, o resumo liga, soma o valor certo e conta os dois; e o resumo é isolado por conta (tenant):

```bash
node tests/mercado-pago-badge.test.js
```

Rode de novo sempre que alterar `Api.getMercadoPagoStatus()` (`js/api.js`) ou `MercadoPagoStatusIndicator` (`js/dashboard.js`).
</details>

<details>
<summary><strong>Performance smoke (ISO/IEC 25010) — <code>tests/performance-smoke.test.js</code></strong></summary>

Executa `js/plans.js`/`js/db.js`/`js/oauth.js`/`js/api.js` de verdade em memória (sem Firebase/rede) e valida limites amplos de tempo para detectar regressões grosseiras em três operações críticas: cadastro + login, inserção em lote de despesas e cálculo da visão mensal de orçamento.

```bash
node tests/performance-smoke.test.js
```

Este teste não substitui teste de carga em produção nem teste de usabilidade com usuários reais, mas formaliza uma verificação periódica de eficiência.
</details>

<details>
<summary><strong>Agente de reconciliação Mercado Pago — <code>orcamento_agent/test_mp_reconcile.py</code></strong></summary>

Testa `mp_reconcile.py` (verificação automática, ambiguidade, sem correspondência, `--dry-run`) com dados simulados, sem chamar a API real do Mercado Pago nem o Firestore real:

```bash
cd orcamento_agent
python3 test_mp_reconcile.py
```

Rode de novo sempre que alterar `mp_reconcile.py`. Veja também `orcamento_agent/test_mp_sync.py`, do agente de orçamento pessoal (sem relação direta com o painel web).
</details>

<details>
<summary><strong>Gerador de despesas Mercado Pago — <code>orcamento_agent/test_mp_expenses.py</code></strong></summary>

Testa `mp_expenses.py` (categorização por palavra-chave, categoria padrão, exclusão de pagamentos que são receita da conta, filtro de descrição, idempotência, `--dry-run`) com dados simulados, sem chamar a API real do Mercado Pago nem o Firestore real:

```bash
cd orcamento_agent
python3 test_mp_expenses.py
```

Rode de novo sempre que alterar `mp_expenses.py`.
</details>

<details>
<summary><strong>Atividades Mercado Pago — <code>orcamento_agent/test_mp_list_activities.py</code></strong></summary>

Testa `mp_list_activities.py` (formatação de linha/resumo por status, filtro por status, exportação CSV/JSON) com pagamentos simulados, sem chamar a API real do Mercado Pago:

```bash
cd orcamento_agent
python3 test_mp_list_activities.py
```

Rode de novo sempre que alterar `mp_list_activities.py`.
</details>

<details>
<summary><strong>Sync Open Finance + cartão MP — <code>orcamento_agent/test_mp_open_finance_sync.py</code></strong></summary>

Testa `mp_open_finance_sync.py` (remoção de CVV/CVC, mascaramento de PAN para `last4`, idempotência e execução em modo webhook com `db_json`) com dados simulados, sem API real:

```bash
cd orcamento_agent
python3 test_mp_open_finance_sync.py
```

Rode de novo sempre que alterar `mp_open_finance_sync.py`.
</details>

<details>
<summary><strong>Ponte COBOL (camada intermediária) — <code>orcamento_agent/test_cobol_bridge.py</code></strong></summary>

Testa `cobol_bridge.py` com dados simulados (sem Firestore real), cobrindo:
validação do contrato mínimo de evento, idempotência por `event_id`,
conciliação por `payment_id`/`txid`/`amount`, atualização de status de quitação e
modo `--dry-run` sem gravação:

```bash
cd orcamento_agent
python3 test_cobol_bridge.py
```

Rode de novo sempre que alterar `cobol_bridge.py`.
</details>

## Grau tecnológico atual

- **Maturidade de produto:** boa para MVP avançado (fluxos de orçamento/despesas, relatórios, integrações e testes automatizados).
- **Maturidade de engenharia:** média (arquitetura modular em `js/api.js`, `js/db.js` e `js/oauth.js`, com persistência híbrida Firestore + fallback local).
- **Maturidade de segurança SaaS:** intermediária/limitada para produção crítica (autenticação e isolamento multi-tenant ainda precisam de endurecimento para cenário internet aberta).
- **Maturidade operacional:** boa em automação pontual (scripts + workflows), porém algumas integrações ainda dependem de execução local/agendada.

## Priorização tecnológica (sem perder o foco)

### Prioridade alta (curto prazo)
1. Autenticação forte e isolamento real por usuário/tenant.
2. Camada backend/serverless para integrações financeiras (Mercado Pago, Open Finance e demais fontes) sem segredos no front-end.
3. Governança de dados financeiros (trilha de auditoria, reconciliação e política de consistência).
   - **Status atual:** trilha de auditoria operacional já ativa no app (`auditEvents`) para ações críticas de despesas, orçamento, pagamentos, plano e equipe, exibida também no Feed.

### Prioridade média
1. Observabilidade de integração (auditoria, métricas de reconciliação, falhas e SLA).
2. Expansão de conectores financeiros compatíveis com o foco em despesas pessoais.

### Prioridade baixa
1. Tecnologias que não aumentem diretamente o controle de despesas (evitar dispersão).

## Roadmap

### Fase 1 — segurança e base de integração
- Endurecer autenticação e isolamento multi-tenant.
- Consolidar governança de dados financeiros no fluxo principal.
- Padronizar contratos de integração e idempotência.

### Fase 2 — expansão de integrações financeiras sem legado IBM
- Evoluir integrações ativas (Mercado Pago e Open Finance) com trilha auditável.
- Cobrir cenários de reconciliação com ambiguidade/reprocessamento.
- Manter isolamento de segredos e execução fora do navegador.

### Fase 3 — unificação sistema ↔ landing page
- Garantir que toda promessa comercial reflita capacidade implementada no painel.
- Padronizar jornada: landing → login → onboarding → primeiro lançamento de despesa.
- Manter separação explícita entre funcionalidades core e complementares.

### Fase 4 — expansão com foco
- Evoluir observabilidade de integrações (métricas/SLA).
- Expandir conectores financeiros sem perder foco em despesas pessoais.
- Incluir automações adicionais somente quando reduzirem esforço operacional no core.

### Backlog técnico adicional (já existente)
- Confirmação automática **em tempo real** via webhook exige backend/serverless dedicado para segredos.
- Persistir o Realizado original da planilha lado a lado com o Previsto importado.
- Permitir edição de categoria de despesa já lançada sem exclusão/recadastro.
- Comparar múltiplos meses no Previsto x Realizado e exportar o comparativo.
- Conectar novos bancos por APIs públicas ou importação de extrato (CSV/OFX).
- Automatizar emissão de NFS-e no mesmo pipeline das reconciliações.
- Avançar compliance para trilha de certificação ISO com auditoria externa.

## Limitações

## Backend Spring Boot (migração completa para API REST)

Foi adicionada uma implementação de backend em **Spring Boot** no diretório absoluto:

- `/home/runner/work/fintech_app.github.io/fintech_app.github.io/backend`

### Decisões implementadas

- Framework: **Spring Boot**
- Banco: **Firestore** (via Firebase Admin SDK)
- API versionada: **`/api/v1`**
- Módulos prioritários entregues no backend:
  - `auth` (`/api/v1/auth/signup`, `/api/v1/auth/login`, `/api/v1/auth/me`)
  - `users` (`/api/v1/users`, `/api/v1/users/invite`)
  - `expenses` (`/api/v1/expenses`, `/api/v1/expenses/quota`, `/api/v1/categories`)
  - `plans` (`/api/v1/plans`, `/api/v1/plans/change`)
  - `payments` (`/api/v1/payments`, `/api/v1/payments/mercado-pago/status`)
- Migração/cutover (documento legado `fintech_saas/db_v1` → coleções backend):
  - `POST /api/v1/migration/map-legacy` (mapeia e mostra prévia + validação)
  - `POST /api/v1/migration/import-legacy` (executa migração inicial e valida consistência)
  - `GET /api/v1/migration/validate` (consistência por tenant/usuário)
  - `GET /api/v1/migration/snapshot` (backup operacional pré-cutover)
  - `POST /api/v1/migration/restore` (rollback com restore; suporta `wipe_first=true`)
  - `GET /api/v1/migration/cutover-runbook` (plano de virada única + rollback)

### Contrato e padrão de erro

- Validação com Bean Validation (`@NotBlank`, `@Email`, etc.)
- Erro REST padronizado:
  - `timestamp`
  - `status`
  - `error`
  - `message`
  - `path`

### Frontend atual consumindo REST sem redesenho de UI

O `js/api.js` agora suporta modo backend por configuração:

- Defina `localStorage.setItem("fintech_api_base_url", "http://localhost:8080")`
  (ou `globalThis.__FINTECH_API_BASE__`) para ativar chamadas REST nos módulos migrados.
- Sem configuração, o comportamento anterior (client-side/localStorage/Firestore no browser) continua igual.
- Métodos não migrados ainda seguem no fallback local para preservar compatibilidade de tela.

### Como rodar o backend

```bash
cd /home/runner/work/fintech_app.github.io/fintech_app.github.io/backend
mvn spring-boot:run
```

> Requer credenciais válidas para `GoogleCredentials.getApplicationDefault()` (Firestore).

- **Confirmação de cadastro por e-mail (backend Java):**
  - O `POST /api/v1/auth/signup` dispara envio de e-mail de confirmação ao cliente.
  - O conteúdo é gerado por um agente IA interno (`RegistrationEmailAiAgent`) e enviado via SMTP (`spring-boot-starter-mail`).
  - Variáveis úteis:
    - `APP_REGISTRATION_EMAIL_ENABLED` (default: `true`)
    - `APP_REGISTRATION_EMAIL_FROM` (default: `no-reply@spacecworp.com`)
    - `SPRING_MAIL_HOST`, `SPRING_MAIL_PORT`, `SPRING_MAIL_USERNAME`, `SPRING_MAIL_PASSWORD`
    - `SPRING_MAIL_SMTP_AUTH`, `SPRING_MAIL_SMTP_STARTTLS`

- **Sem Firebase configurado:** os dados ficam presos ao navegador/dispositivo onde foram criados — não sincronizam entre computadores ou navegadores diferentes — e limpar o cache/localStorage apaga todos os dados.
- **Com Firebase configurado:** os dados sincronizam entre dispositivos, mas a segurança continua sendo apenas lógica (ver [Multi-tenancy](#como-o-sistema-funciona-por-baixo-dos-panos)) — não há Firebase Authentication real, então quem tiver a `apiKey` do projeto (pública, no código-fonte) pode ler/escrever o documento do Firestore diretamente.
- Não há verdadeira separação de acesso entre "contas" — é só uma organização lógica dos dados dentro do mesmo documento/storage.
- **Concorrência (reconectar depois de ficar offline):** quando um dispositivo que ficou offline volta a sincronizar, `js/db.js` faz um merge de 3 vias antes de gravar — isso evita que criações/edições/exclusões feitas em OUTRO dispositivo nesse meio tempo sejam apagadas (validado por `tests/firebase-sync.test.js`).
- **Concorrência (duas gravações ao mesmo tempo, ambas online):** fora do cenário acima, gravações simultâneas dentro da mesma pequena janela de tempo ainda seguem o modelo simples "a última gravação vence" — sem travamento nem transação do Firestore nesse caminho.
- IDs de novos registros (despesas, categorias etc.) são strings geradas no dispositivo (timestamp + sufixo aleatório), não um contador sequencial — de propósito, para não colidir quando dois dispositivos criam registros ao mesmo tempo.
- **Confirmação de pagamento não é tempo real:** nem a IA de OCR do comprovante nem o `mp_reconcile.py` são um webhook bancário — o primeiro depende do usuário enviar o comprovante, o segundo depende de alguém rodar o script (manual ou agendado) e casa por valor+data, não por um identificador exato (ver [Mercado Pago: confirmação automática de pagamentos](#mercado-pago-confirmação-automática-de-pagamentos)).
- Para um SaaS real, com múltiplos usuários acessando de dispositivos diferentes e dados protegidos de verdade, o próximo passo seria adicionar Firebase Authentication e regras de segurança do Firestore por usuário (ver [Roadmap](#roadmap)).
- **OAuth 2.0 próprio (`js/oauth.js`):** implementa o protocolo corretamente (Authorization Code + PKCE, tokens JWT assinados, revogação/rotação, exigência de canal protegido no fluxo e trilha local de auditoria/trace_id dos eventos OAuth — ver [Autenticação](#como-o-sistema-funciona-por-baixo-dos-panos)), mas a chave de assinatura mora no mesmo navegador do "banco" — não é uma fronteira de segurança real contra quem tem acesso a este dispositivo, e não interopera com apps terceiros (não é "Entrar com..." nenhum provedor externo).
- **Nota Fiscal (NFS-e):** `nfse_issuer.py` só emite nota real depois que você contrata uma conta própria num provedor (Focus NFe, referência usada aqui) com certificado digital e-CNPJ — nada disso é fornecido por este repositório. Sem essa configuração, pagamentos ficam com `nfseStatus` pendente/aguardando documento, nunca uma nota fantasma.
- **Certificação ISO:** este repositório mantém artefatos de conformidade em `compliance/`, mas isso não substitui um gap assessment profissional nem uma auditoria externa. Nenhuma norma está certificada hoje.
