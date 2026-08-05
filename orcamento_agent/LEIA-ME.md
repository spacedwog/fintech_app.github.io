# Agente de Controle de Orçamento — Mercado Pago

## O que é
Um agente que puxa pagamentos do Mercado Pago, categoriza automaticamente e compara
com o orçamento previsto na planilha `Orcamento_Casamento_do_Ano.xlsx`, apontando
quais categorias estouraram o previsto. Pode rodar manualmente ou sozinho, em
agendamento, avisando quando algo estourar.

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
- `Orcamento_Casamento_do_Ano.xlsx` — planilha com 4 abas:
  - **Orcamento**: sua estrutura original (Previsto/Realizado por categoria e mês, com status condicional).
  - **MP_Transacoes**: onde o agente grava os pagamentos puxados do Mercado Pago.
  - **Mapeamento**: regras de palavra-chave → categoria (edite para casar com as descrições reais dos seus pagamentos no MP).
  - **Resumo_MP**: comparação automática Previsto x Gasto Mercado Pago por categoria/mês, com status "ESTOURADO" / "DENTRO DO ORÇAMENTO" (via fórmulas — recalcula sozinho).
- `mp_sync.py` — script que busca os pagamentos no Mercado Pago e atualiza a planilha. Feito para rodar sem supervisão (agendado): nunca quebra com traceback cru, sempre grava em `logs/mp_sync.log` e sempre termina com uma linha final clara (OK / ESTOURADO / mês sem orçamento cadastrado / ERRO).
- `test_mp_sync.py` — teste automatizado com dados simulados (não chama a API real). Rode `python3 test_mp_sync.py` depois de qualquer alteração no script.
- `config.example.json` — modelo de configuração (copie para `config.json`, nunca versione o `config.json`).

## Como configurar
1. Gere um Access Token em developers.mercadopago.com.br (veja o passo a passo que te mandei — Suas integrações → aplicação → Credenciais de teste/produção).
2. Copie `config.example.json` para `config.json` e cole o token:
   ```json
   { "mercado_pago_access_token": "SEU_TOKEN", "planilha": "Orcamento_Casamento_do_Ano.xlsx" }
   ```
3. Instale a dependência: `pip install requests`
4. Rode:
   ```
   python3 mp_sync.py                 # sincroniza o mês atual
   python3 mp_sync.py --mes 2025-01   # ou um mês específico
   ```

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

## Agendamento (rodando sozinho)
Foi configurada uma tarefa agendada que roda `mp_sync.py` automaticamente e te avisa
por mensagem quando alguma categoria estourar o orçamento. Veja a periodicidade e
altere quando quiser diretamente pedindo para ajustar o agendamento.

Enquanto `config.json` não tiver um token válido, a execução agendada só vai te
avisar que falta configurar — não falha silenciosamente.

## Próximos passos possíveis
- Conectar outros bancos: hoje o escopo é só Mercado Pago. Para bancos sem API pública
  para pessoa física, o caminho realista é importar extrato exportado (CSV/OFX) — posso
  adicionar um `bank_import.py` que lê esses arquivos e joga na mesma aba MP_Transacoes.
- Trocar "Resumo_MP" por um painel/artefato que você reabre a qualquer hora (sem precisar
  abrir o Excel).
