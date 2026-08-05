# Fintech Spacecworp

Gestão de despesas pessoais, **100% em HTML, CSS e JavaScript**, sem servidor e sem Python. Roda inteiramente no navegador.

> O antigo backend em Python (Streamlit e depois FastAPI) foi descontinuado. Toda a lógica que antes vivia no servidor (autenticação, multi-tenancy, planos, despesas, relatórios) agora roda em JavaScript no cliente. O banco de dados é o arquivo `db.json` na raiz do repositório, usado para inicializar a primeira visita de cada navegador; a partir daí, os dados ficam salvos no `localStorage`, que funciona como fallback/persistência real (já que o site é estático e não tem como escrever de volta no `db.json`).

## Arquitetura

A landing page passou a ser o `index.html`, servido na raiz do repositório (é o que o
GitHub Pages serve via `CNAME`). O antigo `index.html` (tela de login/criação de conta)
virou `login.html`:

```
index.html            -> landing page (marketing, planos, FAQ)
login.html             -> login / criação de conta (empresa)
dashboard.html         -> painel principal (SPA simples)
db.json                 -> banco "de fábrica" (schema vazio), usado só para
                            inicializar a 1ª visita de cada navegador
css/styles.css          -> estilos do login e do painel
css/landing.css         -> estilos da landing page
js/
  plans.js             -> planos (free / pro / enterprise) e limites
  db.js                 -> "banco de dados": localStorage (fallback/persistência
                            real) > db.json (1ª visita) > schema vazio
  crypto-utils.js       -> hash de senha (PBKDF2 + SHA-256 via Web Crypto)
  api.js                 -> toda a lógica de negócio (antes no FastAPI), mesma
                            interface de antes (Auth/Api), agora sem rede
  auth-page.js           -> lógica de login/signup (login.html)
  dashboard.js           -> lógica do painel (despesas, relatórios, alertas, equipe, plano)
  pix.js                  -> geração de QR Code / Pix Copia e Cola (BR Code real)
  receipt-ai.js           -> "IA" (OCR local, Tesseract.js) que lê o comprovante do
                              Pix e confere valor/recebedor automaticamente
```

Não há mais pasta `backend/`, `app.py`, `models/`, `services/` ou `utils/` em Python — o projeto é só front-end estático.

### Persistência (db.json + fallback em localStorage)

O banco de dados é o arquivo **`db.json`**, versionado na raiz do repositório junto com o código (hoje, um schema vazio — sem empresas/usuários). Duas regras simples, em `js/db.js`:

- **Leitura:** se já existe alguma coisa salva no `localStorage` deste navegador (chave `fintech_saas_db_v1`), é isso que é usado — essa é a persistência real do app no dia a dia. Só na **primeira visita** (localStorage vazio) o app busca `db.json` via `fetch()` para inicializar os dados.
- **Gravação:** toda gravação (nova despesa, novo usuário, troca de plano etc.) acontece no `localStorage`. Como o site é 100% estático (GitHub Pages, sem backend), o navegador não tem como escrever de volta no `db.json` remoto — ele não muda sozinho com o uso do app. Se quiser alterar o que um navegador novo recebe de início, edite `db.json` manualmente e publique a alteração.

Se `fetch()` falhar (por exemplo, abrindo `login.html` direto via `file://`, onde o navegador bloqueia esse tipo de leitura), o app cai para um schema vazio, como sempre fez — use a "Opção 2" abaixo (servidor estático local) para garantir que `db.json` carregue.

### Multi-tenancy

Cada empresa que se cadastra vira um "tenant" isolado dentro do mesmo `localStorage`. Todo dado (usuários, categorias, despesas, orçamentos) é filtrado por `tenant_id` na camada `api.js`.

**Importante:** como não existe mais servidor, esse isolamento é apenas lógico/organizacional — não é uma fronteira de segurança real. Qualquer pessoa com acesso ao navegador (DevTools) pode ler ou editar o `localStorage` diretamente. Isso é adequado para demo, protótipo ou uso pessoal/local, mas não deve ser usado como um SaaS multi-empresa real na internet sem um backend de verdade.

### Planos

O sistema só pode ser usado com login (a tela `dashboard.html` redireciona para `login.html` se não houver sessão ativa). Depois de logado, todo usuário tem acesso completo ao sistema — a única diferença entre os planos é o limite diário de despesas:

| Plano | Preço | Despesas/dia |
|---|---|---|
| Free | R$ 0,00 | 6 (cada despesa extra além do limite: cobrança real de R$ 5,00/unidade via Pix) |
| Premium | R$ 19,99/mês | Ilimitadas |

O limite é checado em `js/api.js` (`addExpense`) ao criar cada despesa: ao atingir 6 despesas no dia, a despesa não é salva imediatamente — abre-se um QR Code Pix real (mesma chave usada no site, CNPJ 62.904.267/0001-60) de R$ 5,00; a despesa só é registrada depois que o usuário clica em "Já paguei". Trocar para o plano Premium funciona do mesmo jeito, com um QR Code Pix de R$ 19,99/mês.

**Importante sobre o Pix:** o QR Code e o código "copia e cola" são gerados no formato oficial do Banco Central (BR Code, com CRC16) e apontam para uma chave Pix real — ou seja, quem pagar transfere dinheiro de verdade. O que **não existe** é confirmação automática do recebimento: como o site é 100% estático (sem backend), não há integração com nenhum provedor de pagamentos (PSP) para verificar via webhook se o Pix caiu na conta. A confirmação em "Já paguei" é uma declaração do próprio usuário, não uma verificação bancária. Para confirmação automática de verdade seria necessário contratar um provedor (Mercado Pago, Efí, Asaas, PagSeguro etc.) e rodar um backend que recebesse os webhooks — fora do escopo deste projeto estático.

### "Autenticação"

Sem servidor, não há verificação de assinatura real. A sessão logada fica salva no `localStorage` (`fintech_saas_session_v1`) e as senhas são guardadas com hash PBKDF2 (não em texto puro) usando a Web Crypto API nativa do navegador — mas, de novo, isso é higiene básica, não uma barreira de segurança contra quem tem acesso ao próprio navegador.

## Como rodar

Não precisa instalar nada. Duas opções:

### Opção 1 — abrir direto

Dê duplo clique em `index.html` (landing page) ou vá direto para `login.html`.

### Opção 2 — servidor estático local (recomendado)

Alguns navegadores restringem certas APIs em `file://`. Se algo não funcionar ao abrir direto, sirva a pasta com qualquer servidor estático, por exemplo:

```bash
npx serve .
```

ou, com Python já instalado apenas como utilitário de linha de comando (não faz parte do projeto):

```bash
python -m http.server 5500
```

Acesse `http://localhost:5500`.

## Primeiro uso

1. Abra `index.html` (ou `login.html` diretamente), clique em "Criar empresa" e cadastre a primeira conta (você vira `admin` do tenant).
2. Registre categorias/despesas, veja o resumo mensal, defina orçamento e teste os alertas.
3. Como admin, convide outros usuários em "Equipe" (respeitando o limite do plano) e experimente trocar de plano em "Plano".

## Limitações por ser 100% client-side

- Os dados ficam presos ao navegador/dispositivo onde foram criados — não sincronizam entre computadores ou navegadores diferentes.
- Limpar o cache/localStorage do navegador apaga todos os dados.
- Não há verdadeira separação de acesso entre "empresas" — é só uma organização lógica dos dados dentro do mesmo storage.
- Para um SaaS real, com múltiplos usuários acessando de dispositivos diferentes e dados protegidos de verdade, é necessário um backend com banco de dados próprio (fora do escopo deste projeto, que agora é intencionalmente só HTML/CSS/JS).
