# Fintech SaaS

Versão SaaS multi-tenant do controle de despesas, **100% em HTML, CSS e JavaScript**, sem servidor e sem Python. Roda inteiramente no navegador.

> O antigo backend em Python (Streamlit e depois FastAPI) foi descontinuado. Toda a lógica que antes vivia no servidor (autenticação, multi-tenancy, planos, despesas, relatórios) agora roda em JavaScript no cliente, e os dados ficam salvos no `localStorage` do navegador.

## Arquitetura

```
frontend/
  index.html            -> login / criação de conta (empresa)
  dashboard.html         -> painel principal (SPA simples)
  css/styles.css
  js/
    plans.js             -> planos (free / pro / enterprise) e limites
    db.js                 -> "banco de dados" em localStorage (schema, seeds, ids)
    crypto-utils.js       -> hash de senha (PBKDF2 + SHA-256 via Web Crypto)
    api.js                 -> toda a lógica de negócio (antes no FastAPI), mesma
                              interface de antes (Auth/Api), agora sem rede
    auth-page.js           -> lógica de login/signup
    dashboard.js           -> lógica do painel (despesas, relatórios, alertas, equipe, plano)
```

Não há mais pasta `backend/`, `app.py`, `models/`, `services/` ou `utils/` em Python — o projeto é só front-end estático.

### Multi-tenancy

Cada empresa que se cadastra vira um "tenant" isolado dentro do mesmo `localStorage`. Todo dado (usuários, categorias, despesas, orçamentos) é filtrado por `tenant_id` na camada `api.js`.

**Importante:** como não existe mais servidor, esse isolamento é apenas lógico/organizacional — não é uma fronteira de segurança real. Qualquer pessoa com acesso ao navegador (DevTools) pode ler ou editar o `localStorage` diretamente. Isso é adequado para demo, protótipo ou uso pessoal/local, mas não deve ser usado como um SaaS multi-empresa real na internet sem um backend de verdade.

### Planos

O sistema só pode ser usado com login (a tela `dashboard.html` redireciona para `index.html` se não houver sessão ativa). Depois de logado, todo usuário tem acesso completo ao sistema — a única diferença entre os planos é o limite diário de despesas:

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

Dê duplo clique em `frontend/index.html`.

### Opção 2 — servidor estático local (recomendado)

Alguns navegadores restringem certas APIs em `file://`. Se algo não funcionar ao abrir direto, sirva a pasta com qualquer servidor estático, por exemplo:

```bash
cd frontend
npx serve .
```

ou, com Python já instalado apenas como utilitário de linha de comando (não faz parte do projeto):

```bash
cd frontend
python -m http.server 5500
```

Acesse `http://localhost:5500`.

## Primeiro uso

1. Abra `index.html`, clique em "Criar empresa" e cadastre a primeira conta (você vira `admin` do tenant).
2. Registre categorias/despesas, veja o resumo mensal, defina orçamento e teste os alertas.
3. Como admin, convide outros usuários em "Equipe" (respeitando o limite do plano) e experimente trocar de plano em "Plano".

## Limitações por ser 100% client-side

- Os dados ficam presos ao navegador/dispositivo onde foram criados — não sincronizam entre computadores ou navegadores diferentes.
- Limpar o cache/localStorage do navegador apaga todos os dados.
- Não há verdadeira separação de acesso entre "empresas" — é só uma organização lógica dos dados dentro do mesmo storage.
- Para um SaaS real, com múltiplos usuários acessando de dispositivos diferentes e dados protegidos de verdade, é necessário um backend com banco de dados próprio (fora do escopo deste projeto, que agora é intencionalmente só HTML/CSS/JS).
