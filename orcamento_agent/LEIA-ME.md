# Agente de Controle de Orçamento — Mercado Pago

## O que é
Um agente que puxa pagamentos do Mercado Pago, categoriza automaticamente e compara
com o orçamento previsto na sua planilha de orçamento (qualquer arquivo que você
mesmo exporte/suba, sem nome nem local fixos — veja "Arquivos" abaixo), apontando
quais categorias estouraram o previsto. Pode rodar manualmente ou sozinho, em
agendamento, avisando quando algo estourar.

Para uma leitura rápida e sem configuração — sem Mercado Pago, sem agendamento —
existe também uma versão web: a aba **Importar Orçamento** do painel do site
(`dashboard.html`), onde você sobe a planilha do orçamento (.xlsx/.xls/.csv) direto
no navegador e a leitura (categorias, Previsto/Realizado, estouros) acontece na
hora, 100% client-side (`js/budget-ai.js`). Veja "Próximos passos possíveis" para a
diferença entre as duas.

## ⚠️ Segurança — leia antes de usar
Esta pasta vive dentro de `fintech_app.github.io`, que é um **repositório público**
no GitHub. `config.json` vai conter o Access Token real da sua conta Mercado Pago —
se isso for parar num commit público, qualquer pessoa consegue ler/movimentar sua
conta. Por isso:
- Foi criado um `.gitignore` na raiz do repositório que ignora `orcamento_agent/config.json`,
  `orcamento_agent/logs/` e arquivos de teste. **Confira, antes do primeiro `git add`,
  que `config.json` aparece como ignorado** (`git status` não deve listá-lo).
- Nunca cole o token diretamente numa página HTML, JS de frontend ou em qualquer
  arquivo que vá para o site publicado.
- Se em algum momento o token vazar, revogue/renove em
  developers.mercadopago.com.br → Suas integrações → Credenciais.

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

## Agendamento (rodando sozinho)
Foi configurada uma tarefa agendada que roda `mp_sync.py` automaticamente e te avisa
por mensagem quando alguma categoria estourar o orçamento. Veja a periodicidade e
altere quando quiser diretamente pedindo para ajustar o agendamento.

Enquanto `config.json` não tiver um token válido, a execução agendada só vai te
avisar que falta configurar — não falha silenciosamente.

## mp_sync.py (Python, agendado) x Importar Orçamento (web, sob demanda)
- `mp_sync.py`: automação recorrente — puxa pagamentos reais do Mercado Pago, grava em
  MP_Transacoes e recalcula Previsto x Gasto via fórmulas da planilha. Exige config.json
  com token e uma planilha no formato "largo" (Categoria + Previsto/Realizado por mês,
  abas Mapeamento/MP_Transacoes/Resumo_MP).
- Painel web (`dashboard.html` → Importar Orçamento, `js/budget-ai.js`): leitura pontual,
  sem token nem agendamento — você sobe a planilha (ou um CSV simples de Categoria/
  Previsto/Realizado) e vê na hora quais categorias estouraram. Não grava nada, não
  substitui o `mp_sync.py` para acompanhamento automático dos pagamentos do Mercado Pago.
- Os dois aceitam um "layout de leitura" manual (modal no web, `--criar-layout`/`--ler-orcamento`
  no CLI) para quando a planilha não segue o formato padrão — ver "Layout de leitura" acima.

## Próximos passos possíveis
- Conectar outros bancos: hoje o escopo é só Mercado Pago. Para bancos sem API pública
  para pessoa física, o caminho realista é importar extrato exportado (CSV/OFX) — posso
  adicionar um `bank_import.py` que lê esses arquivos e joga na mesma aba MP_Transacoes.
- Deixar o "Importar Orçamento" do painel web também gravar histórico (hoje é só leitura
  pontual, não persiste os dados enviados).
