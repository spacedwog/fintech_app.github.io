# Fintech Spacecworp

Gestão de despesas pessoais, **100% em HTML, CSS e JavaScript**, sem servidor próprio e sem Python. Roda inteiramente no navegador.

> O antigo backend em Python (Streamlit e depois FastAPI) foi descontinuado. Toda a lógica de negócio (autenticação, multi-tenancy, planos, despesas, relatórios) roda em JavaScript no cliente. O banco de dados primário é o **Firebase (Cloud Firestore)** — quando configurado, os dados sincronizam entre navegadores/dispositivos diferentes. O **`localStorage`** funciona como **fallback automático**: se o Firebase não estiver configurado, o SDK não carregar, o navegador estiver offline, ou a chamada ao Firestore falhar por qualquer motivo, o app segue funcionando 100% localmente e sincroniza com o Firestore assim que possível. O `db.json` na raiz do repositório continua existindo apenas como "banco de fábrica" — usado para popular o Firestore/localStorage na primeiríssima vez que o app é aberto (nenhum dado salvo em nenhuma das duas camadas ainda).

## Arquitetura

A landing page passou a ser o `index.html`, servido na raiz do repositório (é o que o
GitHub Pages serve via `CNAME`). O antigo `index.html` (tela de login/criação de conta)
virou `login.html`:

```
index.html            -> landing page (marketing, planos, FAQ)
login.html             -> login / criação de conta
dashboard.html         -> painel principal (SPA simples)
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
tests/
  firebase-sync.test.js  -> teste de integração (Node) da sincronização com o
                            Firebase — migração, multi-dispositivo, fallback
                            offline e reconciliação (ver "Testes automatizados")
```

Não há mais pasta `backend/`, `app.py`, `models/`, `services/` ou `utils/` em Python — o projeto é só front-end estático.

### Persistência (Firebase/Firestore + fallback em localStorage)

O banco de dados primário é o **Firebase (Cloud Firestore)**. Todo o "banco" (tenants, usuários, categorias, despesas, orçamentos, pagamentos) é salvo como um único documento no Firestore — mesmo formato que já era usado no `db.json`/`localStorage`. Regras, em `js/db.js`:

- **Leitura (`loadDb()`):**
  1. Se o Firebase está configurado (`js/firebase-config.js`) e alcançável, lê o documento do Firestore. Se existir, esse é o dado usado (e uma cópia é guardada no `localStorage` como cache).
  2. Se o documento ainda não existir no Firestore (primeiro uso), o app usa o que tiver no `localStorage` ou, na falta disso, busca o banco de fábrica `db.json` via `fetch()` — e envia esse conteúdo para o Firestore, "adotando-o" como ponto de partida.
  3. Se o Firebase **não** estiver configurado, o SDK não carregar, o navegador estiver offline, ou a chamada falhar por qualquer motivo, o app cai automaticamente para o fluxo antigo: `localStorage` (se já tiver algo salvo) → `db.json` (1ª visita) → schema vazio.
- **Gravação (`saveDb()`):** toda gravação (nova despesa, novo usuário, troca de plano, pagamento etc.) grava **primeiro no `localStorage`** — rápido, síncrono na prática, nunca depende de rede, garante que nada se perde mesmo sem Firebase — e a função retorna imediatamente, sem esperar a rede. O envio ao Firestore roda **em segundo plano**, numa fila que preserva a ordem das gravações, para que nenhuma ação da interface (criar despesa, mudar plano etc.) fique bloqueada esperando o Firebase responder. Se a sincronização falhar, fica marcada como **pendente** e é reenviada automaticamente assim que a conexão volta (evento `online` do navegador), a cada 20s enquanto houver pendência, ou na próxima operação de leitura/gravação.

Ou seja: o app **nunca trava esperando rede** e nunca perde dados por falta de Firebase — o `localStorage` é sempre a rede de segurança. O `db.json` continua existindo só como banco de fábrica (schema inicial) para o primeiríssimo uso, com ou sem Firebase configurado. Veja "Conectando ao Firebase" abaixo para o passo a passo de configuração.

### Multi-tenancy

Cada conta que se cadastra vira um "tenant" isolado dentro do mesmo banco (Firestore e/ou `localStorage`). Todo dado (usuários, categorias, despesas, orçamentos, pagamentos) é filtrado por `tenant_id` na camada `api.js`.

**Importante:** esse isolamento é apenas lógico/organizacional — não é uma fronteira de segurança real, com ou sem Firebase. Sem Firebase, qualquer pessoa com acesso ao navegador (DevTools) pode ler ou editar o `localStorage` diretamente. Com Firebase configurado usando as regras de teste (abertas) descritas no passo a passo abaixo, qualquer pessoa que descubra as credenciais públicas do projeto Firebase (`apiKey` etc., visíveis no código-fonte do site) também consegue ler/escrever o documento no Firestore diretamente. Isso é adequado para demo, protótipo ou uso pessoal, mas **não deve ser usado como um SaaS multi-conta real na internet** sem regras de segurança do Firestore mais restritivas e, idealmente, Firebase Authentication de verdade (fora do escopo atual — ver "Roadmap").

### Planos

O sistema só pode ser usado com login (a tela `dashboard.html` redireciona para `login.html` se não houver sessão ativa). Depois de logado, todo usuário tem acesso completo ao sistema — a única diferença entre os planos é o limite diário de despesas:

| Plano | Preço | Despesas/dia |
|---|---|---|
| Free | R$ 0,00 | 6 (cada despesa extra além do limite: cobrança real de R$ 5,00/unidade via Pix) |
| Premium | R$ 19,99/mês | Ilimitadas |

O limite é checado em `js/api.js` (`addExpense`) ao criar cada despesa: ao atingir 6 despesas no dia, a despesa não é salva imediatamente — abre-se um QR Code Pix real (mesma chave usada no site, CNPJ 62.904.267/0001-60) de R$ 5,00. O usuário paga no app do próprio banco e envia o comprovante; uma IA local (OCR, `js/receipt-ai.js`) confere se o valor e o recebedor batem com a cobrança antes de habilitar a confirmação — se a leitura automática falhar, ainda é possível confirmar manualmente. Trocar para o plano Premium funciona do mesmo jeito, com um QR Code Pix de R$ 19,99/mês.

**Importante sobre o Pix:** o QR Code e o código "copia e cola" são gerados no formato oficial do Banco Central (BR Code, com CRC16) e apontam para uma chave Pix real — ou seja, quem pagar transfere dinheiro de verdade. O que **não existe** é confirmação automática do recebimento: como o site é 100% estático (sem backend), não há integração com nenhum provedor de pagamentos (PSP) para verificar via webhook se o Pix caiu na conta. A confirmação em "Já paguei" é uma declaração do próprio usuário, não uma verificação bancária. Para confirmação automática de verdade seria necessário contratar um provedor (Mercado Pago, Efí, Asaas, PagSeguro etc.) e rodar um backend que recebesse os webhooks — fora do escopo deste projeto estático.

### "Autenticação"

Sem servidor, não há verificação de assinatura real. A sessão logada fica salva no `localStorage` (`fintech_saas_session_v1`) e as senhas são guardadas com hash PBKDF2 (não em texto puro) usando a Web Crypto API nativa do navegador — mas, de novo, isso é higiene básica, não uma barreira de segurança contra quem tem acesso ao próprio navegador.

## Conectando ao Firebase

O app funciona sem Firebase (só com `localStorage`, como sempre funcionou). Para ativar a sincronização em nuvem (dados acessíveis de qualquer navegador/dispositivo), siga os passos abaixo.

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

Abra `js/firebase-config.js` e substitua os valores de exemplo pelos que você copiou:

```js
const FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",
  authDomain: "fintech-spacecworp.firebaseapp.com",
  projectId: "fintech-spacecworp",
  storageBucket: "fintech-spacecworp.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456",
};
```

Salve o arquivo. O app detecta automaticamente que o Firebase está configurado (não precisa mudar mais nada em nenhum outro arquivo) e passa a usar o Firestore como banco primário, com `localStorage` como fallback.

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

**Aviso:** como este projeto não usa Firebase Authentication, não há como as regras do Firestore diferenciarem "seus" usuários de qualquer visitante — quem tiver a `apiKey` (pública, visível no código-fonte do site) consegue ler/escrever esse documento. Isso é aceitável para uso pessoal, demo ou protótipo (mesmo nível de segurança que o `localStorage` já tinha), mas **não é adequado para um SaaS real na internet** — para isso seria necessário adicionar Firebase Authentication e regras por usuário (fora do escopo atual).

### 6. Testar

1. Abra `login.html` (veja "Como rodar" abaixo) e crie uma conta.
2. No console do Firebase, vá em **Firestore Database → Dados** e confirme que apareceu o documento `fintech_saas/db_v1` com os dados da conta criada.
3. Abra o app em outro navegador (ou aba anônima) e faça login com a mesma conta — os dados devem aparecer, confirmando a sincronização.
4. Para testar o fallback: desative sua conexão de internet, use o app normalmente (login já feito, adicionar despesas etc.) e reconecte — as mudanças feitas offline aparecem no Firestore automaticamente.
5. No painel (`dashboard.html`), a barra lateral mostra um indicador de status logo abaixo do plano: bolinha verde + "Sincronizado" (tudo certo com o Firebase), amarela + "Sincronizando…" (há mudanças locais aguardando conexão), ou cinza + "Modo local" (Firebase não configurado). Ele se atualiza sozinho a cada poucos segundos e também ao ficar online/offline.

**Testes automatizados:** `tests/firebase-sync.test.js` executa `js/db.js`/`js/api.js` de verdade (sem modificar nada) contra um Firestore simulado (mesma interface `.collection().doc().get()/.set()` do SDK), cobrindo: migração automática do localStorage para o Firestore, leitura dos mesmos dados a partir de um segundo dispositivo, fallback quando o Firebase cai, e reconciliação (merge de 3 vias) ao reconectar sem apagar mudanças que outro dispositivo tenha sincronizado nesse meio tempo. Não precisa de projeto Firebase real nem de rede — só Node.js:

```bash
node tests/firebase-sync.test.js
```

Se o arquivo já tiver credenciais reais coladas em `js/firebase-config.js`, o teste as usa (só para simular a "ativação" do Firebase; nenhuma chamada de rede é feita de verdade). Rode de novo sempre que alterar `js/db.js` ou `js/api.js`.

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

1. Abra `index.html` (ou `login.html` diretamente), clique em "Criar conta" e cadastre a primeira conta (você vira `admin` do tenant).
2. Registre categorias/despesas, veja o resumo mensal, defina orçamento e teste os alertas.
3. Como admin, convide outros usuários em "Equipe" (respeitando o limite do plano) e experimente trocar de plano em "Plano".

## Roadmap

Hoje o app cobre o registro manual: o usuário lança os pagamentos do mês e paga
o que for necessário (limite excedido, upgrade de plano) via Pix real,
confirmando com o comprovante. A evolução planejada é o próprio sistema
executar o pagamento por conta do usuário — isso depende de um backend
integrado a um provedor de pagamentos (PSP) e está fora do escopo atual.

Com o Firebase já conectado como banco de dados, os próximos passos naturais
para uma segurança real de multi-tenant seriam: (1) trocar a autenticação
client-side (PBKDF2 em `crypto-utils.js`) por **Firebase Authentication**, e
(2) escrever regras do Firestore por usuário (`request.auth.uid`), em vez do
documento único e aberto usado hoje. Isso continua sendo possível sem sair
do modelo 100% front-end estático (Firebase Auth também roda no navegador).

## Limitações

- **Sem Firebase configurado:** os dados ficam presos ao navegador/dispositivo onde foram criados — não sincronizam entre computadores ou navegadores diferentes — e limpar o cache/localStorage apaga todos os dados. Comportamento idêntico ao do projeto antes desta atualização.
- **Com Firebase configurado:** os dados sincronizam entre dispositivos, mas a segurança continua sendo apenas lógica (ver "Multi-tenancy" acima) — não há Firebase Authentication real, então quem tiver a `apiKey` do projeto (pública, no código-fonte) pode ler/escrever o documento do Firestore diretamente.
- Não há verdadeira separação de acesso entre "contas" — é só uma organização lógica dos dados dentro do mesmo documento/storage.
- **Concorrência (reconectar depois de ficar offline):** quando um dispositivo que ficou offline volta a sincronizar, `js/db.js` faz um merge de 3 vias (`_threeWayMerge`, comparando o último estado sincronizado, o que mudou localmente e o que está no Firestore agora) antes de gravar — isso evita que criações/edições/exclusões feitas em OUTRO dispositivo nesse meio tempo sejam apagadas. Esse merge foi validado por um teste automatizado (ver seção de testes abaixo).
- **Concorrência (duas gravações ao mesmo tempo, ambas online):** fora do cenário acima, gravações simultâneas feitas por dois dispositivos dentro da mesma pequena janela de tempo (sem que um deles tenha ficado offline) ainda seguem o modelo simples "a última gravação vence" — não há travamento nem transação do Firestore nesse caminho. Para uso pessoal/pequenas equipes isso raramente é um problema na prática (é preciso duas pessoas salvarem algo no mesmíssimo instante).
- IDs de novos registros (despesas, categorias etc.) são strings geradas no dispositivo (timestamp + sufixo aleatório), não um contador sequencial — de propósito, para não colidir quando dois dispositivos criam registros ao mesmo tempo sem saber um do outro. Bancos antigos com ids numéricos sequenciais continuam funcionando normalmente (são convertidos para string automaticamente ao carregar).
- Para um SaaS real, com múltiplos usuários acessando de dispositivos diferentes e dados protegidos de verdade, o próximo passo seria adicionar Firebase Authentication e regras de segurança do Firestore por usuário (ver Roadmap).
