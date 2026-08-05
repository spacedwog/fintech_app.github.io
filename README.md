# Fintech Spacecworp

![100% front-end](https://img.shields.io/badge/stack-100%25%20HTML%2FCSS%2FJS-2563eb)
![GitHub Pages](https://img.shields.io/badge/hospedagem-GitHub%20Pages-181717)
![Idioma](https://img.shields.io/badge/idioma-PT--BR-16a34a)
![Mercado Pago](https://img.shields.io/badge/pagamentos-Pix%20real%20%2B%20Mercado%20Pago-00b1ea)

Gestão de despesas pessoais, **100% em HTML, CSS e JavaScript**, sem servidor próprio. Roda inteiramente no navegador, com **Firebase (Firestore)** como banco na nuvem e **`localStorage`** como fallback automático. Cobranças (limite diário excedido, upgrade de plano) usam **Pix real**, com um agente local opcional que confirma automaticamente os pagamentos cruzando com a **API do Mercado Pago** — ver [Mercado Pago: confirmação automática de pagamentos](#mercado-pago-confirmação-automática-de-pagamentos).

> O antigo backend em Python (Streamlit e depois FastAPI) foi descontinuado. Toda a lógica de negócio (autenticação, multi-tenancy, planos, despesas, relatórios) roda em JavaScript no cliente. O `db.json` na raiz do repositório é só o "banco de fábrica" usado para popular o Firestore/localStorage na primeiríssima vez que o app é aberto.

## Sumário

- [Navegue pelo painel (`dashboard.html`)](#navegue-pelo-painel-dashboardhtml)
  - [🔄 Orçamento & Despesas (fluxo em 3 páginas)](#-orçamento--despesas-fluxo-em-3-páginas)
  - [📊 Resumo Mensal](#-resumo-mensal)
  - [👥 Equipe](#-equipe)
  - [💳 Plano](#-plano)
- [Mercado Pago: confirmação automática de pagamentos](#mercado-pago-confirmação-automática-de-pagamentos)
- [Como o sistema funciona por baixo dos panos](#como-o-sistema-funciona-por-baixo-dos-panos)
- [Conectando ao Firebase](#conectando-ao-firebase)
- [Como rodar](#como-rodar)
- [Primeiro uso](#primeiro-uso)
- [Testes automatizados](#testes-automatizados)
- [Roadmap](#roadmap)
- [Limitações](#limitações)

---

## Navegue pelo painel (`dashboard.html`)

Depois do login, o painel tem quatro seções na barra lateral, nesta ordem. Clique em cada uma abaixo para expandir o que ela faz e onde está o código.

### 🔄 Orçamento & Despesas (fluxo em 3 páginas)

As antigas telas separadas "Registrar Despesa", "Alertas / Orçamento" e "Importar Orçamento" foram fundidas numa única tela (`view-budget-flow`) com **paginação** — barra "‹ Anterior / Página X de 3 / Próxima ›" e três atalhos diretos ("1. Importar Orçamento", "2. Registrar Despesas", "3. Alertas / Orçamento"). Não são só três abas lado a lado: as páginas **se alimentam uma da outra**, fechando um fluxo só:

1. **Página 1** grava o **Previsto** de cada categoria (a partir de uma planilha) no app.
2. **Página 2** registra despesas de verdade nessas categorias — isso é o **Realizado**.
3. **Página 3** compara os dois, por categoria, com dados 100% reais — não mais o Realizado da própria planilha.

<details>
<summary><strong>Página 1 — Importar Orçamento</strong></summary>

Envie uma planilha de orçamento (.xlsx/.xls/.csv) direto do navegador — a leitura (categorias, Previsto/Realizado, quais categorias estouraram *segundo a planilha*) acontece **100% client-side**, sem subir o arquivo pra nenhum servidor (`js/budget-ai.js`, usa SheetJS + heurística de cabeçalho).

- **Detecção automática**: tenta reconhecer a planilha sozinha (coluna Categoria + Previsto/Realizado, formato largo ou longo).
- **Layout de leitura manual** ("+ Criar layout de leitura"): quando a heurística não reconhece o formato, um modal deixa você descrever exatamente onde está cada coisa (aba, linhas, colunas). O layout fica salvo por conta (sincroniza como o resto do app) e reaplica em uploads futuros.
- **"Usar este orçamento no app"** (novo): depois de ler a planilha, um cartão deixa escolher o mês (do app) em que aplicar o Previsto lido e grava isso de verdade — criando categorias que não existirem (`Api.importCategoryBudgets` em `js/api.js`). É esse passo que conecta a planilha ao restante do fluxo; sem ele, a leitura continua sendo só uma prévia pontual, como antes.
- Existe uma versão equivalente em linha de comando para quem administra a planilha de orçamento fora do navegador — ver `orcamento_agent/LEIA-ME.md` (`--criar-layout`/`--ler-orcamento` do `mp_sync.py`). É um projeto separado (agente de orçamento do casamento), documentado por conta própria; o layout de leitura é o único conceito compartilhado com este app.

Código: `js/dashboard.js` (`loadBudgetView`, `handleBudgetFileUpload`, `showBudgetAdoptCard`, `handleBudgetAdopt`), `js/budget-ai.js`, `Api.importCategoryBudgets` em `js/api.js`.
</details>

<details>
<summary><strong>Página 2 — Registrar Despesas</strong></summary>

Registra despesas com valor, data, categoria e descrição — igual a antes, com um adicional: ao escolher a categoria, um aviso mostra o Previsto x Realizado **daquela categoria no mês atual**, puxado do que foi importado na Página 1 (`Api.getBudgetOverview`), inclusive avisando quando a categoria ainda não tem orçamento definido.

- O limite diário do plano é checado a cada envio (`Api.getExpenseQuota()`). O plano Free tem 6 despesas/dia — a 7ª em diante abre o modal de pagamento Pix (ver [💳 Plano](#-plano)) antes de salvar.
- Categorias são criadas na mesma tela (`category-form`) e ficam por conta (tenant) — inclusive as criadas automaticamente ao importar um orçamento na Página 1 ou ao gerar despesas via Mercado Pago (ver abaixo).
- Excluir uma despesa (botão "Excluir" na tabela) não devolve cota do dia, mas atualiza o Realizado mostrado na hora (aqui e na Página 3).
- Despesas com o selo **Mercado Pago** na tabela não foram digitadas por ninguém — foram geradas automaticamente a partir de um pagamento real (`orcamento_agent/mp_expenses.py`, fora do navegador) e não contam para o limite diário do plano Free (é importação de histórico, não uma ação em tempo real do usuário). Ver [Mercado Pago: confirmação automática de pagamentos](#mercado-pago-confirmação-automática-de-pagamentos).
- Além do selo por linha, a **sidebar do painel** (todas as telas, não só esta) mostra um badge **Mercado Pago** único e sempre visível, logo abaixo do indicador de sincronização: resume quantas despesas foram geradas e quantos pagamentos foram confirmados via Mercado Pago, com a data da atualização mais recente (tudo por conta/tenant). Cinza/apagado quando nenhum dado do Mercado Pago chegou ainda; colorido quando há pelo menos uma despesa gerada ou um pagamento confirmado. Ver `MercadoPagoStatusIndicator`/`Api.getMercadoPagoStatus()` abaixo.

Código: `js/dashboard.js` (`loadExpensesView`, `refreshExpenseCategoryBudgetInfo`, `refreshQuotaInfo`, `refreshExpenseTable`, `MercadoPagoStatusIndicator`), lógica de negócio em `js/api.js` (`addExpense`, `getMercadoPagoStatus`).
</details>

<details>
<summary><strong>Página 3 — Alertas / Orçamento</strong></summary>

Duas comparações independentes, uma embaixo da outra:

- **Limite geral do mês (como antes):** um único valor total por mês, sem categoria (`budget-form`) — mostra se o total de despesas do mês já passou desse limite (`alerts-box`).
- **Previsto x Realizado por categoria (novo):** tabela com um seletor de mês, cruzando o Previsto importado na **Página 1** com o Realizado somado das despesas reais da **Página 2** (`Api.getBudgetOverview`) — a conta inteira, não só o usuário logado. Cada categoria fica com um destes selos: <span title="previsto e dentro do limite">DENTRO DO ORÇAMENTO</span>, <span title="realizado maior que o previsto">ESTOURADO</span>, ou <span title="tem despesa no mês mas nenhum Previsto foi importado para ela">SEM ORÇAMENTO</span> — este último existe de propósito, para nunca fingir que uma categoria sem orçamento definido está "dentro do previsto".

Código: `js/dashboard.js` (`loadAlertsView`, `loadBudgetOverview`), `Api.setBudget`/`Api.getAlerts`/`Api.getBudgetOverview` em `js/api.js`.
</details>

### 📊 Resumo Mensal

<details>
<summary>O que é e como funciona</summary>

Dois gráficos (Chart.js): gasto total por mês (barras) e gasto por categoria no período (rosca). Somam todas as despesas do tenant, sem filtro de usuário — qualquer membro vê o resumo completo da conta.

Código: `js/dashboard.js` (`loadReportsView`), dados vindos de `Api.monthlyReport()`/`Api.categoryReport()` em `js/api.js`.
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
| Free | R$ 0,00 | 6 (cada despesa extra: cobrança real de R$ 5,00/unidade via Pix) |
| Premium | R$ 19,99/mês | Ilimitadas |

Trocar de plano (ou pagar a despesa extra) abre o **modal de Pix real**: QR Code + "copia e cola" válidos no formato do Banco Central (BR Code, CRC16), apontando pra chave Pix real da SPACECWORP (CNPJ 62.904.267/0001-60). Quem escanear/pagar transfere dinheiro de verdade.

Depois de pagar, o usuário envia o comprovante e cada pagamento pode ganhar até dois selos independentes no histórico:
- **✓ comprovante validado por IA** — OCR local (`js/receipt-ai.js`, Tesseract.js) leu o comprovante enviado na hora e confirmou valor + recebedor.
- **✓ verificado via Mercado Pago** — um agente local (fora do navegador) cruzou o pagamento com a API do Mercado Pago depois do fato. Ver a próxima seção.

Se nenhum dos dois bater, o pagamento fica com **⚠ confirmação manual** — o usuário declarou que pagou, mas nada confirmou automaticamente ainda.

Código: `js/dashboard.js` (`loadPlanView`, `selectPlan`, `openPixPayment`, `renderPaymentsHistory`), `js/pix.js` (payload BR Code), `js/plans.js` (regras dos planos), `Api.addPayment`/`Api.listPayments`/`Api.changePlan` em `js/api.js`.
</details>

---

## Mercado Pago: confirmação automática de pagamentos

O site é 100% estático (GitHub Pages) — o Access Token do Mercado Pago **nunca** pode ir para o navegador. Por isso a cobrança em si continua sendo um Pix estático real (ver [💳 Plano](#-plano) acima), e a confirmação automática roda como um **agente local separado**, que só existe fora do site publicado:

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
orcamento_agent/
  mp_reconcile.py        -> confirma automaticamente pagamentos do painel web
                            cruzando com o Mercado Pago (ver seção própria acima)
  mp_expenses.py          -> gera despesas reais na Página 2 a partir de
                            pagamentos do Mercado Pago (ver seção própria acima)
  mp_sync.py, ...        -> agente separado para planilha de orçamento pessoal,
                            sem relação com este app (ver orcamento_agent/LEIA-ME.md)
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

O limite é checado em `js/api.js` (`addExpense`) ao criar cada despesa: ao atingir 6 despesas no dia, a despesa não é salva imediatamente — abre-se um QR Code Pix real (mesma chave usada no site, CNPJ 62.904.267/0001-60) de R$ 5,00. O usuário paga no app do próprio banco e envia o comprovante; uma IA local (OCR, `js/receipt-ai.js`) confere se o valor e o recebedor batem com a cobrança antes de habilitar a confirmação — se a leitura automática falhar, ainda é possível confirmar manualmente. Trocar para o plano Premium funciona do mesmo jeito, com um QR Code Pix de R$ 19,99/mês.

**Importante sobre o Pix:** o QR Code e o código "copia e cola" são gerados no formato oficial do Banco Central (BR Code, com CRC16) e apontam para uma chave Pix real — ou seja, quem pagar transfere dinheiro de verdade. A confirmação em "Já paguei" é uma declaração do próprio usuário; o que a valida de fato depois é a IA de OCR (na hora) e/ou o agente `mp_reconcile.py` (depois do fato, ver [Mercado Pago: confirmação automática de pagamentos](#mercado-pago-confirmação-automática-de-pagamentos)) — nenhum dos dois é um webhook bancário em tempo real.
</details>

<details>
<summary><strong>"Autenticação"</strong></summary>

Sem servidor, não há verificação de assinatura real. A sessão logada fica salva no `localStorage` (`fintech_saas_session_v1`) e as senhas são guardadas com hash PBKDF2 (não em texto puro) usando a Web Crypto API nativa do navegador — mas, de novo, isso é higiene básica, não uma barreira de segurança contra quem tem acesso ao próprio navegador.
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
2. Em [🔄 Orçamento & Despesas](#-orçamento--despesas-fluxo-em-3-páginas): importe uma planilha (Página 1) ou registre categorias/despesas direto (Página 2), veja o resumo mensal e confira os alertas (Página 3).
3. Como admin, convide outros usuários em [👥 Equipe](#-equipe) (respeitando o limite do plano) e experimente trocar de plano em [💳 Plano](#-plano).

## Testes automatizados

<details>
<summary><strong>Painel web — <code>tests/firebase-sync.test.js</code></strong></summary>

Executa `js/db.js`/`js/api.js` de verdade (sem modificar nada) contra um Firestore simulado (mesma interface `.collection().doc().get()/.set()` do SDK), cobrindo: migração automática do localStorage para o Firestore, leitura dos mesmos dados a partir de um segundo dispositivo, fallback quando o Firebase cai, e reconciliação (merge de 3 vias) ao reconectar sem apagar mudanças que outro dispositivo tenha sincronizado nesse meio tempo. Não precisa de projeto Firebase real nem de rede — só Node.js:

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

## Roadmap

- ~~Cruzar os pagamentos do painel web com dados reais do Mercado Pago~~ — feito com `orcamento_agent/mp_reconcile.py` (best-effort, por valor+data, roda localmente). Ver [Mercado Pago: confirmação automática de pagamentos](#mercado-pago-confirmação-automática-de-pagamentos).
- Confirmação automática **em tempo real** (webhook de verdade, sem depender de rodar um script) exigiria criar as cobranças via API do Mercado Pago (Payment Brick/Preferences) em vez de um Pix estático, e isso depende de um backend/serverless para guardar o Access Token com segurança — fora do escopo 100% front-end estático atual.
- Com o Firebase já conectado como banco de dados, os próximos passos naturais para uma segurança real de multi-tenant seriam: (1) trocar a autenticação client-side (PBKDF2 em `crypto-utils.js`) por **Firebase Authentication**, e (2) escrever regras do Firestore por usuário (`request.auth.uid`), em vez do documento único e aberto usado hoje. Isso continua sendo possível sem sair do modelo 100% front-end estático (Firebase Auth também roda no navegador).
- ~~Deixar o "Importar Orçamento" do painel web também gravar histórico~~ — feito: a Página 1 do fluxo [🔄 Orçamento & Despesas](#-orçamento--despesas-fluxo-em-3-páginas) agora persiste o Previsto por categoria (`Api.importCategoryBudgets`), comparado na Página 3 com despesas reais. Falta persistir o Realizado *original da própria planilha* lado a lado (hoje ele só aparece na pré-visualização da Página 1, sem gravar).
- ~~Usar os dados do Mercado Pago para gerar despesas~~ — feito com `orcamento_agent/mp_expenses.py`: pagamentos reais que não são receita da conta viram despesas de verdade na Página 2, categorizadas por palavra-chave. Ver [Gerar despesas automaticamente (`mp_expenses.py`)](#gerar-despesas-automaticamente-mp_expensespy).
- Editar a categoria de uma despesa já lançada (hoje só dá para excluir e relançar) — ajudaria a corrigir categorizações erradas do `mp_expenses.py` sem reimportar.
- Deixar a Página 3 comparar mais de um mês ao mesmo tempo (hoje é um seletor de mês por vez) e exportar o comparativo Previsto x Realizado de volta para planilha.
- Conectar outros bancos além do Mercado Pago: para bancos sem API pública para pessoa física, o caminho realista é importar extrato exportado (CSV/OFX).

## Limitações

- **Sem Firebase configurado:** os dados ficam presos ao navegador/dispositivo onde foram criados — não sincronizam entre computadores ou navegadores diferentes — e limpar o cache/localStorage apaga todos os dados.
- **Com Firebase configurado:** os dados sincronizam entre dispositivos, mas a segurança continua sendo apenas lógica (ver [Multi-tenancy](#como-o-sistema-funciona-por-baixo-dos-panos)) — não há Firebase Authentication real, então quem tiver a `apiKey` do projeto (pública, no código-fonte) pode ler/escrever o documento do Firestore diretamente.
- Não há verdadeira separação de acesso entre "contas" — é só uma organização lógica dos dados dentro do mesmo documento/storage.
- **Concorrência (reconectar depois de ficar offline):** quando um dispositivo que ficou offline volta a sincronizar, `js/db.js` faz um merge de 3 vias antes de gravar — isso evita que criações/edições/exclusões feitas em OUTRO dispositivo nesse meio tempo sejam apagadas (validado por `tests/firebase-sync.test.js`).
- **Concorrência (duas gravações ao mesmo tempo, ambas online):** fora do cenário acima, gravações simultâneas dentro da mesma pequena janela de tempo ainda seguem o modelo simples "a última gravação vence" — sem travamento nem transação do Firestore nesse caminho.
- IDs de novos registros (despesas, categorias etc.) são strings geradas no dispositivo (timestamp + sufixo aleatório), não um contador sequencial — de propósito, para não colidir quando dois dispositivos criam registros ao mesmo tempo.
- **Confirmação de pagamento não é tempo real:** nem a IA de OCR do comprovante nem o `mp_reconcile.py` são um webhook bancário — o primeiro depende do usuário enviar o comprovante, o segundo depende de alguém rodar o script (manual ou agendado) e casa por valor+data, não por um identificador exato (ver [Mercado Pago: confirmação automática de pagamentos](#mercado-pago-confirmação-automática-de-pagamentos)).
- Para um SaaS real, com múltiplos usuários acessando de dispositivos diferentes e dados protegidos de verdade, o próximo passo seria adicionar Firebase Authentication e regras de segurança do Firestore por usuário (ver [Roadmap](#roadmap)).
