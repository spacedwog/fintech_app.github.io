# Agente de Controle de Orçamento — Mercado Pago

## O que é
Esta pasta reúne quatro agentes que usam a conta do Mercado Pago (via API ou via
e-mail) com o mesmo cuidado de segurança (nenhum segredo sai da máquina local):

1. **`mp_sync.py`** — puxa pagamentos do Mercado Pago, categoriza automaticamente e
   compara com o orçamento previsto numa planilha de orçamento (ex.: o orçamento do
   casamento). Documentado abaixo.
2. **`mp_reconcile.py`** — cruza pagamentos aprovados do Mercado Pago com o
   **histórico de pagamentos do painel web** (`dashboard.html` → aba **Plano**),
   confirmando automaticamente cobranças de Pix (despesa extra / assinatura) que o
   usuário só tinha declarado manualmente. Ver "Reconciliação com o painel web
   (`mp_reconcile.py`)" mais abaixo.
3. **`mp_expenses.py`** — usa os mesmos pagamentos reais do Mercado Pago (via API,
   com Access Token) para **gerar despesas de verdade** na Página 2 ("Registrar
   Despesas") do fluxo 🔄 Orçamento & Despesas do painel web, categorizando
   automaticamente e sem duplicar o que já é receita da conta (assinatura/despesa
   extra). Ver "Gerar despesas a partir do Mercado Pago (`mp_expenses.py`)" mais
   abaixo.
4. **`mp_email_expenses.py`** — mesmo objetivo de `mp_expenses.py` (gerar despesas
   reais na Página 2), mas a partir dos **e-mails de notificação** que o Mercado
   Pago manda a cada pagamento, em vez da API — não precisa de Access Token, só de
   acesso IMAP a uma caixa de entrada que receba esses e-mails. Ver "Gerar despesas
   a partir dos e-mails do Mercado Pago (`mp_email_expenses.py`)" mais abaixo.

Além dos quatro, **`mp_list_activities.py`** é um utilitário só de leitura: lista as
atividades (pagamentos) reais da conta do Mercado Pago no terminal (e pode exportar
para CSV/JSON), sem gerar nenhuma despesa e sem precisar de Firebase nem de nenhuma
cópia do banco do painel — só o Access Token que já está em `config.json` (ou
qualquer um dos outros configs desta pasta). Útil para conferir rápido o que existe
na conta antes de configurar `mp_reconcile.py`/`mp_expenses.py` de verdade. Ver
"Ver as atividades do Mercado Pago sem gerar despesas (`mp_list_activities.py`)"
mais abaixo.

Para uma leitura rápida e sem configuração — sem Mercado Pago, sem agendamento —
existe também uma versão web para orçamento: a aba **Importar Orçamento** do painel
do site (`dashboard.html`), onde você sobe a planilha do orçamento (.xlsx/.xls/.csv)
direto no navegador e a leitura (categorias, Previsto/Realizado, estouros) acontece
na hora, 100% client-side (`js/budget-ai.js`). Veja "mp_sync.py x Importar
Orçamento" para a diferença entre as duas.

## ⚠️ Segurança — leia antes de usar
Esta pasta vive dentro de `fintech_app.github.io`, que é um **repositório público**
no GitHub. `config.json` (e, se você usar `mp_reconcile.py`/`mp_expenses.py`, também
`mp_reconcile_config.json`/`mp_expenses_config.json`) vai conter o Access Token real
da sua conta Mercado Pago — se isso for parar num commit público, qualquer pessoa
consegue ler/movimentar sua conta. Se você usar `mp_email_expenses.py`, o
`mp_email_expenses_config.json` vai conter a senha (idealmente uma "senha de app")
de uma caixa de entrada de e-mail real — um segredo igualmente sensível. O mesmo
vale para uma eventual chave de conta de serviço do Firebase (dá acesso de
leitura/escrita total ao banco do app). Por isso:
- Foi criado um `.gitignore` na raiz do repositório que ignora `orcamento_agent/config.json`,
  `orcamento_agent/mp_reconcile_config.json`, `orcamento_agent/mp_expenses_config.json`,
  `orcamento_agent/mp_email_expenses_config.json`, qualquer
  `*serviceAccount*.json`/`*service-account*.json`/`firebase-adminsdk*.json`
  dentro desta pasta, `orcamento_agent/logs/` e arquivos de teste. **Confira, antes do
  primeiro `git add`, que esses arquivos aparecem como ignorados** (`git status` não
  deve listá-los).
- Nunca cole nenhum desses segredos diretamente numa página HTML, JS de frontend ou
  em qualquer arquivo que vá para o site publicado.
- Se em algum momento algum deles vazar: revogue/renove o Access Token em
  developers.mercadopago.com.br → Suas integrações → Credenciais; troque a senha de
  app da caixa de entrada (Gmail/Outlook → Segurança) se for o caso de
  `mp_email_expenses.py`; para a chave do Firebase, revogue em Console do Firebase →
  Configurações do projeto → Contas de serviço.

## Arquivos
- Planilha de orçamento (qualquer nome/local — informe via `--planilha` ou no
  `config.json`, veja "Como configurar") — precisa ter 4 abas:
  - **Orcamento**: sua estrutura original (Previsto/Realizado por categoria e mês, com status condicional).
  - **MP_Transacoes**: onde o agente grava os pagamentos puxados do Mercado Pago.
  - **Mapeamento**: regras de palavra-chave → categoria (edite para casar com as descrições reais dos seus pagamentos no MP).
  - **Resumo_MP**: comparação automática Previsto x Gasto Mercado Pago por categoria/mês, com status "ESTOURADO" / "DENTRO DO ORÇAMENTO" (via fórmulas — recalcula sozinho).
- `mp_sync.py` — script que busca os pagamentos no Mercado Pago e atualiza a planilha. Feito para rodar sem supervisão (agendado): nunca quebra com traceback cru, sempre grava em `logs/mp_sync.log` e sempre termina com uma linha final clara (OK / ESTOURADO / mês sem orçamento cadastrado / ERRO).
- `test_mp_sync.py` — teste automatizado com dados simulados (não chama a API real). Rode `python3 test_mp_sync.py` depois de qualquer alteração no script.
- `config.example.json` — modelo de configuração (copie para `config.json`, nunca versione o `config.json`).
- `budget_layout.py` — lê Previsto/Realizado de uma planilha usando um "layout" (aba/linhas/colunas
  definidos por você) em vez de assumir a estrutura fixa da aba Orcamento. Ver "Layout de leitura" abaixo.
- `layout.example.json` / `layout.example.longo.json` — modelos de layout (formato largo e longo).
- `mp_reconcile.py` — cruza pagamentos aprovados do Mercado Pago com o histórico de
  pagamentos do painel web (Firestore ou uma cópia local do banco) e confirma
  automaticamente os que baterem por valor+data. Ver seção própria abaixo.
- `test_mp_reconcile.py` — teste automatizado do `mp_reconcile.py` com dados simulados
  (não chama a API real nem o Firestore real). Rode `python3 test_mp_reconcile.py`
  depois de qualquer alteração no script.
- `mp_reconcile_config.example.json` — modelo de configuração do `mp_reconcile.py`
  (copie para `mp_reconcile_config.json`, nunca versione o arquivo copiado).
- `mp_expenses.py` — gera despesas de verdade no painel web a partir de pagamentos
  reais do Mercado Pago, categorizando por palavra-chave. Ver seção própria abaixo.
- `test_mp_expenses.py` — teste automatizado do `mp_expenses.py` com dados simulados
  (não chama a API real nem o Firestore real). Rode `python3 test_mp_expenses.py`
  depois de qualquer alteração no script.
- `mp_expenses_config.example.json` — modelo de configuração do `mp_expenses.py`
  (copie para `mp_expenses_config.json`, nunca versione o arquivo copiado).
- `mp_email_expenses.py` — gera despesas de verdade no painel web a partir dos
  E-MAILS de notificação do Mercado Pago (sem precisar de Access Token). Ver seção
  própria abaixo.
- `test_mp_email_expenses.py` — teste automatizado do `mp_email_expenses.py` com
  e-mails simulados (não conecta em nenhuma caixa de entrada real nem chama a API).
  Rode `python3 test_mp_email_expenses.py` depois de qualquer alteração no script.
- `mp_email_expenses_config.example.json` — modelo de configuração do
  `mp_email_expenses.py` (copie para `mp_email_expenses_config.json`, nunca versione
  o arquivo copiado).
- `mp_list_activities.py` — utilitário só de leitura: lista/exporta as atividades
  reais da conta do Mercado Pago sem gerar despesa nenhuma. Ver seção própria abaixo.
- `test_mp_list_activities.py` — teste automatizado do `mp_list_activities.py` com
  pagamentos simulados (não chama a API real). Rode `python3 test_mp_list_activities.py`
  depois de qualquer alteração no script.

## Ver as atividades do Mercado Pago sem gerar despesas (`mp_list_activities.py`)
Antes de configurar o Firebase para `mp_reconcile.py`/`mp_expenses.py` valer a pena,
pode ser útil só **ver** o que existe na conta primeiro: quantos pagamentos, que
valores, que descrições. O `mp_list_activities.py` faz exatamente isso — busca as
atividades (pagamentos) reais na API do Mercado Pago e mostra numa tabela no
terminal, com um resumo por status e o total aprovado no período. **Não grava nada**
em lugar nenhum (nem no painel web, nem no Mercado Pago) — só precisa do Access
Token que já está em `config.json` (reaproveita automaticamente o primeiro entre
`config.json`, `mp_reconcile_config.json`, `mp_expenses_config.json` ou
`mp_email_expenses_config.json` que existir, já que todos usam a mesma conta).

**Rodar:**
```bash
cd orcamento_agent
python3 mp_list_activities.py                      # últimos 30 dias
python3 mp_list_activities.py --dias 90
python3 mp_list_activities.py --status approved     # só um status
python3 mp_list_activities.py --export mp_activities.csv   # também salva um CSV
python3 mp_list_activities.py --export mp_activities.json  # ou um JSON, pela extensão
```
Rode `python3 test_mp_list_activities.py` depois de qualquer alteração no script.

⚠️ Se usar `--export`, o arquivo salvo tem dados financeiros reais (valores,
descrições, e-mail de quem pagou) — os nomes sugeridos acima (`mp_activities.*`)
já estão cobertos pelo `.gitignore`; se usar outro nome, adicione-o também antes de
commitar.

## Como configurar
1. Gere um Access Token em developers.mercadopago.com.br (veja o passo a passo que te mandei — Suas integrações → aplicação → Credenciais de teste/produção).
2. Copie `config.example.json` para `config.json`, cole o token e aponte para a
   sua planilha (qualquer arquivo, qualquer nome):
   ```json
   { "mercado_pago_access_token": "SEU_TOKEN", "planilha": "meu_orcamento.xlsx" }
   ```
3. Instale a dependência: `pip install requests`
4. Rode:
   ```
   python3 mp_sync.py                              # sincroniza o mês atual
   python3 mp_sync.py --mes 2025-01                 # ou um mês específico
   python3 mp_sync.py --planilha outro_orcamento.xlsx   # usa outra planilha sem editar o config.json
   ```
   A planilha só precisa seguir a mesma estrutura de abas (veja "Arquivos" acima) —
   valida automaticamente e avisa com uma mensagem clara se alguma aba estiver faltando.

## Importante: orçamento de teste só tem Jan/Fev/Mar de 2025
A planilha enviada como teste só tinha Previsto cadastrado para esses 3 meses.
Se você rodar `mp_sync.py` para um mês fora desse intervalo (ex: o mês atual real),
ele grava os pagamentos normalmente em `MP_Transacoes`, mas avisa que **não existe
orçamento cadastrado para aquele mês** em vez de fingir que está tudo certo — não
gera falso "dentro do orçamento". Para esse aviso sumir, adicione as colunas
Previsto/Realizado do mês na aba **Orcamento** (mesmo padrão das colunas existentes:
`Previsto` e `Realizado` mescladas sob o nome do mês, ex. `Agosto - 2026`).

## Ajustar categorização
Edite a aba **Mapeamento** na planilha: cada linha é uma palavra-chave (sem acento,
minúscula) que, se aparecer na descrição do pagamento no Mercado Pago, joga o valor
para aquela Categoria. Pagamentos que não baterem com nenhuma regra caem em
"Não categorizado" — revise essas linhas na aba MP_Transacoes de vez em quando.

## Layout de leitura (quando o formato foge do padrão)
Tanto o painel web quanto o `mp_sync.py` esperam, por padrão, uma planilha no formato
"largo" (Categoria + colunas Previsto/Realizado por mês, lado a lado — igual à aba
Orcamento). Se a sua planilha tiver outro layout (outra aba, outras colunas, formato
"longo" com uma linha por categoria+mês), dá pra descrever exatamente onde está cada
coisa em vez de depender de heurística:

- **No painel web** (`dashboard.html` → Importar Orçamento): clique em **"+ Criar
  layout de leitura"**. Um modal deixa você escolher a aba, o formato (largo/longo) e
  as linhas/colunas de cada campo; o layout fica salvo (por conta, sincronizado como o
  resto do app) e pode ser reaplicado em uploads futuros pelo seletor "Layout de leitura".
- **No `mp_sync.py`** (CLI, sem token nem Mercado Pago): mesmo conceito, em formato de
  assistente por perguntas:
  ```
  python3 mp_sync.py --criar-layout                 # cria layout.json (ou --layout outro.json)
  python3 mp_sync.py --ler-orcamento --layout layout.json --planilha meu_orcamento.xlsx
  ```
  `--ler-orcamento` só lê e imprime o resumo (Previsto/Realizado/Saldo/Status por
  categoria, e o total) — não grava nada na planilha nem mexe no Mercado Pago. Útil pra
  conferir rápido uma planilha nova, mesmo antes de configurar o Access Token.

Os campos do layout são os mesmos dos dois lados (o `layout.json` gerado pelo assistente
usa a mesma estrutura salva pelo modal web — ver `layout.example.json`/`layout.example.longo.json`):
`name`, `sheetName`, `format` ("largo" ou "longo") e, conforme o formato,
`colCategoriaLarga`/`monthRow`/`subHeaderRow` (largo) ou
`headerRow`/`colCategoria`/`colMes`/`colPrevisto`/`colRealizado` (longo).

## Reconciliação com o painel web (`mp_reconcile.py`)
O painel (`dashboard.html`) cobra Pix real (despesa extra do plano Free, assinatura
Premium) via QR Code/copia-e-cola — ver `js/pix.js` e `PIX_MERCHANT` em
`js/dashboard.js`. Como o site é 100% estático, a confirmação de "já paguei" no
modal é **uma declaração do usuário**, opcionalmente reforçada por uma IA local de
OCR (`js/receipt-ai.js`) que lê o comprovante enviado — ver "Importante sobre o
Pix" no README.md da raiz. O `mp_reconcile.py` fecha essa lacuna sem expor nenhum
segredo no site: ele roda só localmente, busca no Mercado Pago os pagamentos
aprovados de verdade (mesma conta da chave Pix usada no modal) e cruza por
valor+data com o histórico de pagamentos já gravado pelo app (Firestore ou uma
cópia local do banco) — confirmando automaticamente (`verifiedByMercadoPago: true`)
os que baterem com clareza, e deixando os ambíguos (dois pagamentos reais com o
mesmo valor na mesma janela) para revisão manual, sem arriscar confirmar o errado.

**Configurar:**
1. Copie `mp_reconcile_config.example.json` → `mp_reconcile_config.json` e cole o
   mesmo Access Token do Mercado Pago (`config.json` e `mp_reconcile_config.json`
   podem usar o mesmo token — são a mesma conta).
2. Escolha a fonte dos dados do app (defina **uma** das duas em `mp_reconcile_config.json`):
   - `firebase_service_account`: caminho de uma chave de conta de serviço do Firebase
     (Console do Firebase → Configurações do projeto → Contas de serviço → Gerar
     nova chave privada). Lê/grava direto no mesmo Firestore usado pelo painel web —
     recomendado, é a fonte "de verdade" quando o Firebase está configurado (ver
     "Conectando ao Firebase" no README.md).
   - `db_json`: caminho de uma cópia local do banco no formato do `db.json`/
     localStorage — alternativa sem Firebase, mas não alcança o localStorage de um
     navegador em outra máquina.
3. Instale as dependências: `pip install requests openpyxl --break-system-packages`
   (e, só se for usar Firestore, `pip install firebase-admin --break-system-packages`).
4. Rode:
   ```
   python3 mp_reconcile.py --dry-run          # mostra o que faria, sem gravar nada
   python3 mp_reconcile.py                    # reconcilia de verdade (últimos 30 dias)
   python3 mp_reconcile.py --dias 60          # janela maior
   ```
5. Rode `python3 test_mp_reconcile.py` depois de qualquer alteração no script (dados
   simulados, não chama a API real nem o Firestore real).

No painel web, um pagamento reconciliado aparece no histórico (aba **Plano**) com o
selo "verificado via Mercado Pago", ao lado do selo de IA já existente.

**Limitações (por design):** não é webhook/tempo real — depende de rodar o script
(manual ou agendado); a correspondência é por valor+data (o Pix pago pelo usuário
não carrega nenhum identificador do app até chegar no Mercado Pago), então dois
pagamentos reais de mesmo valor na mesma janela de dias ficam como "ambíguos" em vez
de arriscar confirmar o errado.

## Gerar despesas a partir do Mercado Pago (`mp_expenses.py`)
O fluxo 🔄 Orçamento & Despesas do painel web (Página 1 importa o Previsto, Página 2
registra despesas reais, Página 3 compara os dois) funciona hoje com lançamento
manual na Página 2. O `mp_expenses.py` fecha esse fluxo automaticamente: busca os
mesmos pagamentos reais do Mercado Pago que `mp_reconcile.py` já usa, e cada
pagamento aprovado que **não** for uma cobrança recebida pelo próprio app (assinatura
Premium ou despesa extra pagas por algum usuário do painel via Pix — essas são
receita da conta, não despesa) se torna uma despesa de verdade, já categorizada por
palavra-chave.

**Como decide o que é despesa e o que é receita da conta:**
1. **Exclusão precisa**: qualquer pagamento do Mercado Pago já marcado como
   `verifiedByMercadoPago`/`mercadoPagoPaymentId` num registro de `payments` (ou seja,
   já reconciliado por `mp_reconcile.py` como assinatura/despesa extra) nunca se torna
   despesa. **Por isso, rode `mp_reconcile.py` pelo menos uma vez antes deste script.**
2. **Reforço heurístico**: mesmo sem ter rodado o passo 1, qualquer pagamento cuja
   descrição contenha um termo de `ignorar_descricoes_contendo` (padrão: "despesa
   extra", "assinatura", "fintech spacecworp") também é descartado.
3. O que sobra é categorizado por palavra-chave (`mapeamento` do config, mesma ideia
   da aba Mapeamento do `mp_sync.py`) — sem correspondência, cai em `categoria_padrao`
   (cria a categoria automaticamente se não existir).

**Configurar:**
1. Copie `mp_expenses_config.example.json` → `mp_expenses_config.json`, cole o Access
   Token do Mercado Pago (mesma conta de `config.json`/`mp_reconcile_config.json`) e
   preencha `"conta_email"` — o e-mail de login da conta do painel web que vai receber
   as despesas (precisa já existir, ou seja, já ter feito login pelo menos uma vez).
2. Escolha a fonte de dados (`firebase_service_account` ou `db_json`, mesmo esquema de
   `mp_reconcile_config.json`).
3. Ajuste `mapeamento`/`categoria_padrao`/`ignorar_descricoes_contendo` como preferir.
4. Instale as dependências: `pip install requests openpyxl --break-system-packages`
   (e `firebase-admin` se for usar Firestore).
5. Rode:
   ```
   python3 mp_reconcile.py                  # rode isto primeiro (marca o que é receita)
   python3 mp_expenses.py --dry-run         # mostra o que geraria, sem gravar nada
   python3 mp_expenses.py                   # gera as despesas de verdade
   python3 mp_expenses.py --dias 90         # janela maior
   ```
6. Rode `python3 test_mp_expenses.py` depois de qualquer alteração no script.

**Idempotência:** cada despesa gerada guarda o id do pagamento no Mercado Pago
(`mercadoPagoPaymentId`) — rodar de novo nunca duplica. No painel web, essas despesas
aparecem na Página 2 com o selo "gerada via Mercado Pago" (ver README.md da raiz) e
também entram na contagem do badge **Mercado Pago** que fica sempre visível na sidebar
do painel (abaixo do indicador de sincronização, em qualquer tela) — resume quantas
despesas foram geradas e quantos pagamentos foram confirmados via Mercado Pago
(`mp_reconcile.py`), com a data da atualização mais recente. Ver `Api.getMercadoPagoStatus()`
em `js/api.js` e `MercadoPagoStatusIndicator` em `js/dashboard.js`.

**Limitações (por design):** não roda em tempo real (depende de executar o script);
sem categorização manual pelo painel ainda (crie/edite `mapeamento` no config e rode
de novo — despesas já geradas não são recategorizadas automaticamente); pagamentos
que nunca aparecerem em `payments` nem baterem no filtro de descrição podem, em teoria,
ser lançados como despesa mesmo sendo receita — por isso a recomendação de sempre
rodar `mp_reconcile.py` antes.

## Gerar despesas a partir dos e-mails do Mercado Pago (`mp_email_expenses.py`)
Mesmo objetivo de `mp_expenses.py` (fechar o fluxo 🔄 Orçamento & Despesas gerando
despesas reais na Página 2, sem digitar nada), mas por um caminho que **não precisa de
Access Token nenhum**: o Mercado Pago manda um e-mail a cada pagamento aprovado (ex.:
"Você fez um pagamento de R$ 35,50 para UBER"); este script lê esses e-mails direto
numa caixa de entrada via IMAP, extrai valor/descrição/data e gera a despesa — reaproveitando
a MESMA categorização por palavra-chave e a MESMA idempotência de `mp_expenses.py`
(`mp_email_expenses.generate_expenses` é, na prática, `mp_expenses.generate_expenses`
reutilizado sem alteração).

**Quando usar este em vez de `mp_expenses.py`:** quando você não quer/não pode gerar um
Access Token do Mercado Pago, ou só quer confirmar rápido a integração sem cadastro
nenhum. `mp_expenses.py` continua sendo mais preciso (todos os pagamentos aprovados,
direto da API); este aqui depende do e-mail ter chegado e do texto seguir um padrão
reconhecível — mesmo espírito best-effort do cruzamento por valor+data de
`mp_reconcile.py`. Os dois podem rodar lado a lado (não conflitam, mas também não se
deduplicam entre si — ver "Limitações" abaixo).

**Como decide o que é despesa, o que é receita e o que ignorar (por e-mail):**
1. **Classificação por palavra-chave no assunto/corpo do e-mail** — três grupos,
   verificados nesta ordem: `ignorar_sempre_contendo` (cancelado, estornado, recusado,
   pendente — nunca vira despesa, independente do resto), `palavras_receita_contendo`
   ("você recebeu", "recebeu um pagamento" etc. — a conta RECEBEU dinheiro, mesma
   lógica de exclusão de receita do `mp_expenses.py`, nunca vira despesa) e
   `palavras_despesa_contendo` ("pagamento aprovado", "compra aprovada" etc. — só esses
   viram despesa). E-mails que não batem com nenhum grupo são ignorados por segurança
   (mais seguro do que arriscar lançar algo que não é um pagamento de verdade).
2. **Extração do valor**: procura um valor no formato `R$ 1.234,56` primeiro no assunto,
   depois no corpo (preferindo uma linha que contenha a palavra "valor"). E-mails
   classificados como despesa mas sem nenhum valor reconhecível são ignorados
   (aparecem no resumo como "sem_valor" — revise manualmente esses casos).
3. Igual a `mp_expenses.py`: o que sobra é categorizado por palavra-chave (`mapeamento`
   do config, aplicada sobre o assunto do e-mail) — sem correspondência, cai em
   `categoria_padrao`.

**Configurar:**
1. Copie `mp_email_expenses_config.example.json` → `mp_email_expenses_config.json`.
2. Preencha os dados IMAP da caixa de entrada que recebe os avisos do Mercado Pago —
   `imap_server`, `email_address`, `email_password` (gere uma "senha de app" se a conta
   de e-mail tiver 2FA, o que é o normal em Gmail/Outlook) — e `mailbox` se não for a
   caixa de entrada padrão.
3. Preencha `"conta_email"` — o e-mail de login da conta do painel web que vai receber
   as despesas (precisa já existir; pode ser diferente do `email_address` do IMAP).
4. Escolha a fonte de dados do app (`firebase_service_account` ou `db_json`, mesmo
   esquema de `mp_expenses_config.json`).
5. Ajuste `mapeamento`/`categoria_padrao`/`ignorar_descricoes_contendo` como preferir
   (mesmos campos de `mp_expenses.py`) e, se quiser, sobrescreva as listas de
   classificação (`palavras_despesa_contendo`/`palavras_receita_contendo`/
   `ignorar_sempre_contendo` — deixe `null` para usar o padrão embutido no script).
6. Nenhuma dependência extra além do que a suíte já usa (`openpyxl`/`requests`, se for
   usar Firestore junto com `firebase-admin`) — a leitura de e-mail usa só a biblioteca
   padrão do Python (`imaplib`/`email`).
7. Rode:
   ```
   python3 mp_email_expenses.py --dry-run      # mostra o que geraria, sem gravar nada
   python3 mp_email_expenses.py                # gera as despesas de verdade
   python3 mp_email_expenses.py --dias 90       # janela maior
   ```
8. Rode `python3 test_mp_email_expenses.py` depois de qualquer alteração no script
   (e-mails simulados, sem IMAP nem API reais).

**Idempotência:** cada despesa gerada guarda o Message-ID do e-mail de origem no mesmo
campo `mercadoPagoPaymentId` que `mp_expenses.py` usa — rodar de novo nunca duplica. No
painel web, essas despesas aparecem na Página 2 com o selo "Mercado Pago (e-mail)"
(distinto do selo "Mercado Pago (API)" das despesas geradas por `mp_expenses.py` — ver
README.md da raiz) e entram na mesma contagem do badge da sidebar.

**Limitações (por design):** depende do e-mail ter chegado na caixa configurada (se o
Mercado Pago mudar o texto/padrão dos e-mails, a extração pode parar de reconhecer
algum caso — revise `logs/mp_email_expenses.log`); só reconhece um valor por e-mail
(o primeiro "R$ ..." relevante); não cruza com `mp_expenses.py` — rodar os dois para o
mesmo período pode gerar duas despesas para o mesmo pagamento real (um por
`mercadoPagoPaymentId` numérico da API, outro pelo Message-ID do e-mail) — escolha um
dos dois caminhos como principal, ou revise manualmente se usar os dois.

## Agendamento (rodando sozinho)
Foi configurada uma tarefa agendada que roda `mp_sync.py` automaticamente e te avisa
por mensagem quando alguma categoria estourar o orçamento. Veja a periodicidade e
altere quando quiser diretamente pedindo para ajustar o agendamento. O mesmo pode
ser feito para `mp_reconcile.py`/`mp_expenses.py`/`mp_email_expenses.py` (ex.: rodar
todo dia, sempre `mp_reconcile.py` antes de `mp_expenses.py`) — basta pedir para
configurar o agendamento.

Enquanto `config.json`/`mp_reconcile_config.json`/`mp_expenses_config.json` não
tiverem um token válido (ou, no caso de `mp_email_expenses_config.json`, dados IMAP
válidos), a execução agendada só vai avisar que falta configurar — não falha
silenciosamente.

## mp_sync.py x mp_reconcile.py x mp_expenses.py x mp_email_expenses.py x Importar Orçamento — qual usar
Os quatro primeiros usam a conta do Mercado Pago (API ou e-mail); o quinto é só
leitura local — cada um resolve uma coisa diferente:
- **`mp_sync.py`** (Python, agendado): automação recorrente para a planilha de
  orçamento (ex.: casamento) — puxa pagamentos reais do Mercado Pago, grava em
  MP_Transacoes e recalcula Previsto x Gasto via fórmulas da planilha. Exige
  `config.json` com token e uma planilha no formato "largo" (Categoria +
  Previsto/Realizado por mês, abas Mapeamento/MP_Transacoes/Resumo_MP).
- **`mp_reconcile.py`** (Python, agendado): automação recorrente para o **painel web**
  (`dashboard.html`) — puxa os mesmos pagamentos reais do Mercado Pago, mas cruza com
  o histórico de pagamentos do app (Firestore/db.json) em vez de uma planilha, para
  confirmar automaticamente cobranças de Pix (despesa extra/assinatura) declaradas
  manualmente. Exige `mp_reconcile_config.json` com token + fonte de dados
  (`firebase_service_account` ou `db_json`). Ver seção própria acima.
- **`mp_expenses.py`** (Python, agendado, rode depois de `mp_reconcile.py`): também
  para o **painel web**, mas em vez de confirmar cobranças recebidas, faz o caminho
  inverso: gera despesas reais na Página 2 do fluxo Orçamento & Despesas a partir dos
  pagamentos do Mercado Pago que **não** são receita da conta. Exige
  `mp_expenses_config.json` com token, `conta_email` e fonte de dados. Ver seção
  própria acima.
- **`mp_email_expenses.py`** (Python, agendado, sem Access Token): mesmo objetivo de
  `mp_expenses.py` (gerar despesas reais na Página 2), mas lendo os e-mails de
  notificação do Mercado Pago via IMAP em vez da API. Exige
  `mp_email_expenses_config.json` com dados IMAP, `conta_email` e fonte de dados. Ver
  seção própria acima.
- **Painel web → Importar Orçamento** (`js/budget-ai.js`): leitura pontual, sem token
  nem agendamento, sem Mercado Pago — você sobe a planilha (ou um CSV simples de
  Categoria/Previsto/Realizado) e vê na hora quais categorias estouraram. Não grava
  nada, não substitui nenhum dos scripts acima.
- `mp_sync.py` e o painel web aceitam um "layout de leitura" manual (modal no web,
  `--criar-layout`/`--ler-orcamento` no CLI) para quando a planilha de orçamento não
  segue o formato padrão — ver "Layout de leitura" acima (não se aplica a
  `mp_reconcile.py`/`mp_expenses.py`/`mp_email_expenses.py`, que não lidam com
  planilhas).

## Próximos passos possíveis
- ~~Cruzar os pagamentos reais do Mercado Pago com o histórico de pagamentos do
  painel web~~ — feito em `mp_reconcile.py` (ver seção acima).
- ~~Usar os dados do Mercado Pago para gerar despesas no painel web~~ — feito em
  `mp_expenses.py` (ver seção acima).
- ~~Gerar despesas a partir dos e-mails do Mercado Pago, sem precisar de Access
  Token~~ — feito em `mp_email_expenses.py` (ver seção acima).
- Cruzar `mp_expenses.py` e `mp_email_expenses.py` entre si (hoje, rodar os dois para
  o mesmo período pode gerar duas despesas para o mesmo pagamento real, uma por API e
  outra por e-mail — ver "Limitações" na seção do `mp_email_expenses.py`).
- Conectar outros bancos: hoje o escopo é só Mercado Pago. Para bancos sem API pública
  para pessoa física, o caminho realista é importar extrato exportado (CSV/OFX) — posso
  adicionar um `bank_import.py` que lê esses arquivos e joga na mesma aba MP_Transacoes
  (planilha) ou nas despesas do painel web (mesmo formato de `mp_expenses.py`).
- Deixar o "Importar Orçamento" do painel web também gravar histórico (hoje é só leitura
  pontual, não persiste os dados enviados).
- Permitir editar a categoria de uma despesa já registrada no painel web (hoje só dá
  para excluir e lançar de novo) — ajudaria a corrigir categorizações erradas do
  `mp_expenses.py` sem depender de reimportar.
- Trocar a heurística valor+data do `mp_reconcile.py` (e a exclusão por payments/filtro
  do `mp_expenses.py`) por um vínculo exato: criar os pagamentos do painel web via API
  do Mercado Pago (Payment Brick/Preferences) em vez de um Pix estático, o que exige um
  backend para guardar o Access Token com segurança (fora do escopo 100% front-end
  estático atual — ver Roadmap no README.md).
