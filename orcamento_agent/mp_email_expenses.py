#!/usr/bin/env python3
"""
Agente que gera despesas no painel web (dashboard.html) a partir dos
E-MAILS de notificação do Mercado Pago -- caminho alternativo a
mp_expenses.py para quem não quer (ou não pode) gerar um Access Token da
API do Mercado Pago. Em vez de consultar a API, este script lê a própria
caixa de entrada (IMAP) em busca dos e-mails que o Mercado Pago manda a
cada pagamento aprovado ("Você fez um pagamento de R$ X para Y", "Compra
aprovada", etc.), extrai valor/descrição/data de cada um e alimenta a
MESMA geração de despesas já usada por mp_expenses.py (mp_expenses.generate_expenses)
-- ou seja, mesma categorização por palavra-chave, mesma exclusão do que é
receita da conta e mesma idempotência (nunca duplica ao rodar de novo).

Por que existe / quando usar este em vez de mp_expenses.py:
  - mp_expenses.py precisa de um Access Token do Mercado Pago (API
    /v1/payments/search) -- mais preciso (todos os pagamentos, sem depender
    do texto do e-mail), mas exige criar credenciais em
    developers.mercadopago.com.br.
  - mp_email_expenses.py (este arquivo) só precisa de acesso IMAP a uma
    caixa de entrada que já recebe os e-mails do Mercado Pago (a mesma
    conta, ou qualquer caixa para onde esses e-mails sejam encaminhados) --
    zero cadastro no Mercado Pago. Em compensação, depende do e-mail ter
    chegado e do texto dele seguir um padrão reconhecível (best-effort,
    igual ao cruzamento por valor+data do mp_reconcile.py).
  Os dois podem rodar lado a lado sem duplicar despesas: a idempotência de
  mp_expenses.generate_expenses() é por "mercadoPagoPaymentId", e aqui usamos
  o Message-ID do e-mail nesse mesmo campo -- ids diferentes dos ids
  numéricos da API, então nunca colidem, mas também nunca casam um pagamento
  visto pelos dois caminhos como sendo o mesmo (pode gerar 2 despesas para
  o mesmo pagamento real se você rodar os dois scripts para o mesmo período
  -- ver "Limitações" no LEIA-ME.md).

O que faz:
  1. Conecta na caixa de entrada configurada via IMAP e busca e-mails dos
     remetentes do Mercado Pago (`remetentes_mercado_pago`) dentro da janela
     de dias configurada.
  2. Classifica cada e-mail por palavra-chave no assunto/corpo: "despesa"
     (pagamento/compra feita pela conta -- vira despesa), "receita" (a
     conta RECEBEU um pagamento -- nunca vira despesa, mesmo espírito da
     exclusão de mp_expenses.py) ou "ignorar" (cancelado/estornado/
     recusado/pendente -- não é um gasto de verdade ainda ou não mais).
     E-mails que não batem com nenhuma palavra-chave conhecida são
     ignorados por padrão (mais seguro do que arriscar um falso positivo).
  3. Extrai o valor (regex "R$ 123,45") e a data (cabeçalho Date do e-mail)
     de cada e-mail classificado como "despesa", montando uma lista no
     MESMO formato que mp_sync.fetch_mp_payments() devolveria da API.
  4. Passa essa lista para mp_expenses.generate_expenses() -- reaproveita
     100% da categorização por palavra-chave, exclusão de receita e
     idempotência já testadas em mp_expenses.py, sem duplicar lógica.
  5. Marca cada despesa criada com mercadoPagoSource="email" (além dos
     campos generatedByMercadoPago/mercadoPagoPaymentId que mp_expenses.py
     já grava) -- o painel web mostra a origem no selo "Mercado Pago" da
     Página 2 (ver js/dashboard.js).

Uso:
  python3 mp_email_expenses.py --dry-run          (mostra o que geraria, sem gravar)
  python3 mp_email_expenses.py                    (gera de verdade, últimos 30 dias)
  python3 mp_email_expenses.py --dias 90
  python3 mp_email_expenses.py --config outro_config.json

Requer um mp_email_expenses_config.json (veja mp_email_expenses_config.example.json)
com os dados IMAP da caixa de entrada, "conta_email" (e-mail da conta do
painel web que vai receber as despesas) e a fonte de dados do app
(firebase_service_account OU db_json -- mesmo esquema de mp_expenses.py).

⚠️ Segurança: a senha da caixa de entrada (idealmente uma "senha de app" --
Gmail/Outlook não deixam usar a senha normal por IMAP com 2FA ativado, o que
já é mais seguro por padrão) é um segredo tão sensível quanto o Access Token
do Mercado Pago: quem tiver esse config lê seus e-mails. Nunca versione
mp_email_expenses_config.json (já está no .gitignore).

Reescrito em POO: MimeDecoder (decodifica assunto/corpo MIME, inclusive
HTML), EmailValueParser (extrai valor em R$ e data), EmailClassifier
(despesa/receita/ignorar por palavra-chave), EmailPaymentParser (converte um
e-mail já classificado no formato de pagamento que mp_expenses.py entende) e
ImapEmailFetcher (busca os e-mails de verdade via IMAP) compõem
MercadoPagoEmailExpenseAgent, que orquestra run() de ponta a ponta. A função
de nível de módulo `fetch_mp_emails` (usada pelo agente) e a classe
EmailPaymentParser são as duas costuras que o teste usa para simular e-mails
sem precisar de uma caixa de entrada real (mesmo espírito do monkeypatch de
mp_sync.fetch_mp_payments nos outros testes desta pasta).
"""
import argparse
import hashlib
import html as html_module
import imaplib
import json
import os
import re
import sys
import traceback
from datetime import datetime, timedelta
from email import message_from_bytes
from email.header import decode_header
from email.utils import parsedate_to_datetime

import mp_expenses  # generate_expenses, find_user_by_email -- reaproveita a mesma geração de despesas
import mp_reconcile  # build_source (Firestore/db.json) -- mesma fonte de dados do painel web
import mp_sync  # normalize -- mesma normalização de texto usada em toda a suite Mercado Pago

DEFAULT_REMETENTES = ["mercadopago.com.br", "mercadopago.com"]

# Palavras (sem acento, minúsculas -- comparadas via mp_sync.normalize) que
# indicam que O USUÁRIO pagou algo (vira despesa). Cobre os padrões mais
# comuns de assunto/corpo dos e-mails de pagamento aprovado do Mercado Pago.
DEFAULT_PALAVRAS_DESPESA = [
    "pagamento aprovado", "compra aprovada", "voce fez um pagamento",
    "pagamento realizado", "compra realizada", "cobranca aprovada",
    "voce comprou", "pagamento efetuado", "fatura fechada", "assinatura cobrada",
]

# Palavras que indicam que a conta RECEBEU dinheiro -- nunca vira despesa
# (mesmo espírito da exclusão de receita em mp_expenses.py).
DEFAULT_PALAVRAS_RECEITA = [
    "voce recebeu", "recebeu um pagamento", "recebeu uma transferencia",
    "pagamento recebido", "recebeu um pix", "dinheiro recebido", "recebeu uma cobranca",
]

# Palavras que indicam que o pagamento NÃO deve virar despesa por outro
# motivo (não é um gasto de verdade ainda, ou deixou de ser).
DEFAULT_IGNORAR_SEMPRE = [
    "cancelado", "cancelada", "estornado", "estornada", "reembolsado", "reembolsada",
    "devolucao", "chargeback", "pagamento pendente", "pagamento recusado",
    "pagamento rejeitado", "nao foi possivel processar",
]

VALOR_RE = re.compile(r"R\$\s*([\d\.]{1,12},\d{2})")


def log(linha):
    try:
        base = os.path.dirname(os.path.abspath(__file__))
        logdir = os.path.join(base, "logs")
        os.makedirs(logdir, exist_ok=True)
        with open(os.path.join(logdir, "mp_email_expenses.log"), "a", encoding="utf-8") as f:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            f.write(f"[{ts}] {linha}\n")
    except Exception:
        pass


# ---------- MimeDecoder: assunto/corpo de um email.message.Message ----------

class MimeDecoder:
    @staticmethod
    def decode_words(raw):
        """Decodifica um cabeçalho MIME (ex.: Subject) que pode vir
        codificado (=?UTF-8?B?...?=) em texto normal."""
        if not raw:
            return ""
        partes = decode_header(raw)
        out = []
        for texto, charset in partes:
            if isinstance(texto, bytes):
                out.append(texto.decode(charset or "utf-8", errors="replace"))
            else:
                out.append(texto)
        return "".join(out)

    @staticmethod
    def strip_html(html_src):
        """HTML -> texto simples (best-effort, sem depender de nenhuma lib
        de parsing HTML extra -- os e-mails do Mercado Pago não precisam de
        nada além disso para extrair valor/assunto)."""
        texto = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html_src)
        texto = re.sub(r"(?i)<br\s*/?>", "\n", texto)
        texto = re.sub(r"(?i)</p>", "\n", texto)
        texto = re.sub(r"<[^>]+>", " ", texto)
        texto = html_module.unescape(texto)
        return re.sub(r"[ \t]+", " ", texto)

    @classmethod
    def body_text(cls, msg):
        """Corpo do e-mail em texto simples: prefere text/plain; sem isso,
        cai para text/html (convertido). Nunca lança exceção -- devolve
        string vazia se não conseguir decodificar nada."""
        try:
            if msg.is_multipart():
                html_fallback = None
                for part in msg.walk():
                    ctype = part.get_content_type()
                    disp = str(part.get("Content-Disposition") or "")
                    if "attachment" in disp.lower():
                        continue
                    if ctype == "text/plain":
                        charset = part.get_content_charset() or "utf-8"
                        payload = part.get_payload(decode=True)
                        if payload:
                            return payload.decode(charset, errors="replace")
                    elif ctype == "text/html" and html_fallback is None:
                        charset = part.get_content_charset() or "utf-8"
                        payload = part.get_payload(decode=True)
                        if payload:
                            html_fallback = payload.decode(charset, errors="replace")
                return cls.strip_html(html_fallback) if html_fallback else ""
            else:
                charset = msg.get_content_charset() or "utf-8"
                payload = msg.get_payload(decode=True)
                if not payload:
                    return ""
                texto = payload.decode(charset, errors="replace")
                return cls.strip_html(texto) if msg.get_content_type() == "text/html" else texto
        except Exception:
            return ""


# ---------- EmailValueParser: valor (R$) e data ----------

class EmailValueParser:
    @staticmethod
    def parse_valor(texto):
        """Primeiro valor em formato R$ 1.234,56 encontrado no texto, já
        convertido para float (None se não encontrar nenhum)."""
        if not texto:
            return None
        m = VALOR_RE.search(texto)
        if not m:
            return None
        bruto = m.group(1).replace(".", "").replace(",", ".")
        try:
            return float(bruto)
        except ValueError:
            return None

    @staticmethod
    def parse_valor_preferindo_linha_com(texto, palavra):
        """Tenta achar um valor numa linha que contenha `palavra` (ex.:
        "valor") antes de aceitar o primeiro valor do texto inteiro --
        reduz a chance de pegar um valor secundário (ex.: saldo, taxa)
        quando o corpo do e-mail tem mais de um "R$ ..."."""
        if not texto:
            return None
        palavra_norm = mp_sync.normalize(palavra)
        for linha in texto.splitlines():
            if palavra_norm in mp_sync.normalize(linha):
                valor = EmailValueParser.parse_valor(linha)
                if valor is not None:
                    return valor
        return EmailValueParser.parse_valor(texto)

    @staticmethod
    def parse_date(msg):
        """Data do cabeçalho Date do e-mail, no formato YYYY-MM-DD. Cai para
        hoje se o cabeçalho estiver ausente ou for inválido (nunca lança)."""
        raw = msg.get("Date")
        if raw:
            try:
                dt = parsedate_to_datetime(raw)
                if dt is not None:
                    return dt.strftime("%Y-%m-%d")
            except (TypeError, ValueError):
                pass
        return datetime.now().strftime("%Y-%m-%d")


# ---------- EmailClassifier: despesa / receita / ignorar / desconhecido ----------

class EmailClassifier:
    def __init__(self, palavras_despesa=None, palavras_receita=None, ignorar_sempre=None):
        self.palavras_despesa = palavras_despesa or DEFAULT_PALAVRAS_DESPESA
        self.palavras_receita = palavras_receita or DEFAULT_PALAVRAS_RECEITA
        self.ignorar_sempre = ignorar_sempre or DEFAULT_IGNORAR_SEMPRE

    def _bate_alguma(self, texto_norm, lista):
        for termo in lista:
            if mp_sync.normalize(termo) in texto_norm:
                return True
        return False

    def classify(self, subject, body):
        # Só olha um trecho do corpo (e-mails de notificação são curtos;
        # limitar evita falso positivo vindo de um rodapé/termos de uso).
        texto_norm = mp_sync.normalize(f"{subject or ''} {(body or '')[:2000]}")
        if self._bate_alguma(texto_norm, self.ignorar_sempre):
            return "ignorar"
        if self._bate_alguma(texto_norm, self.palavras_receita):
            return "receita"
        if self._bate_alguma(texto_norm, self.palavras_despesa):
            return "despesa"
        return "desconhecido"


# ---------- EmailPaymentParser: email.message.Message -> dict "mp_payment" ----------

class EmailPaymentParser:
    """Converte um e-mail do Mercado Pago já recebido (email.message.Message)
    num dict no MESMO formato que mp_sync.fetch_mp_payments() devolveria da
    API (id/status/transaction_amount/description/date_approved) -- assim
    mp_expenses.generate_expenses() nem precisa saber que a origem foi um
    e-mail em vez da API."""

    def __init__(self, classifier):
        self.classifier = classifier

    def parse(self, msg):
        """Devolve (payment_dict_ou_None, classe). payment_dict é None quando
        o e-mail deve ser ignorado -- quem chama decide o que fazer com a
        classe (estatísticas/log)."""
        subject = MimeDecoder.decode_words(msg.get("Subject"))
        body = MimeDecoder.body_text(msg)

        classe = self.classifier.classify(subject, body)
        if classe != "despesa":
            return None, classe

        valor = EmailValueParser.parse_valor(subject)
        if valor is None:
            valor = EmailValueParser.parse_valor_preferindo_linha_com(body, "valor")
        if valor is None:
            return None, "sem_valor"

        message_id = str(msg.get("Message-ID") or "").strip()
        if not message_id:
            # Fallback determinístico (mesmo e-mail reprocessado gera sempre o
            # mesmo id) para e-mails sem Message-ID -- raro, mas evita duplicar
            # em execuções futuras mesmo nesse caso.
            base = f"{msg.get('From')}|{msg.get('Date')}|{subject}"
            message_id = "sememailid-" + hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]

        payment = {
            "id": message_id,
            "status": "approved",
            "transaction_amount": valor,
            "description": subject.strip() or "(sem assunto)",
            "date_approved": EmailValueParser.parse_date(msg),
        }
        return payment, classe


# ---------- ImapEmailFetcher: busca de verdade na caixa de entrada ----------

class ImapEmailFetcher:
    def __init__(self, cfg):
        self.host = cfg.get("imap_server")
        self.port = int(cfg.get("imap_port") or 993)
        self.email_address = cfg.get("email_address")
        self.password = cfg.get("email_password")
        self.mailbox = cfg.get("mailbox") or "INBOX"

    def _build_or_from(self, remetentes):
        remetentes = [r for r in (remetentes or []) if r]
        if not remetentes:
            return ""
        expr = f'FROM "{remetentes[-1]}"'
        for r in reversed(remetentes[:-1]):
            expr = f'OR FROM "{r}" {expr}'
        return expr

    def fetch(self, remetentes, dias):
        """Devolve a lista de email.message.Message dos remetentes do
        Mercado Pago recebidos nos últimos `dias` dias. Levanta exceção em
        caso de falha de conexão/login (quem chama decide como reportar)."""
        if not self.host or not self.email_address or not self.password:
            raise RuntimeError(
                "Configuração IMAP incompleta -- preencha \"imap_server\", \"email_address\" e "
                "\"email_password\" em mp_email_expenses_config.json."
            )

        conn = imaplib.IMAP4_SSL(self.host, self.port)
        try:
            conn.login(self.email_address, self.password)
            conn.select(self.mailbox)

            since = (datetime.now() - timedelta(days=dias)).strftime("%d-%b-%Y")
            criterio = f"(SINCE {since}) {self._build_or_from(remetentes)}".strip()
            typ, data = conn.search(None, criterio)
            if typ != "OK":
                raise RuntimeError(f"Busca IMAP falhou ({typ}): {criterio}")

            mensagens = []
            for msg_id in (data[0].split() if data and data[0] else []):
                typ, msg_data = conn.fetch(msg_id, "(RFC822)")
                if typ != "OK" or not msg_data or not msg_data[0]:
                    continue
                raw = msg_data[0][1]
                mensagens.append(message_from_bytes(raw))
            return mensagens
        finally:
            try:
                conn.close()
            except Exception:
                pass
            try:
                conn.logout()
            except Exception:
                pass


def fetch_mp_emails(cfg, dias):
    """Ponto de entrada usado pelo agente -- reatribuído diretamente pelos
    testes (monkeypatch) pra simular a caixa de entrada sem IMAP real, no
    mesmo espírito de mp_sync.fetch_mp_payments."""
    remetentes = cfg.get("remetentes_mercado_pago") or DEFAULT_REMETENTES
    return ImapEmailFetcher(cfg).fetch(remetentes, dias)


# ---------- MercadoPagoEmailExpenseAgent: orquestra run() de ponta a ponta ----------

class MercadoPagoEmailExpenseAgent:
    def run(self, args):
        if not os.path.exists(args.config):
            return "erro", (
                f"Config não encontrado: {args.config}. Copie mp_email_expenses_config.example.json -> "
                f"{args.config} e preencha os dados IMAP, \"conta_email\" e a fonte de dados."
            )

        with open(args.config, encoding="utf-8") as f:
            cfg = json.load(f)

        conta_email = cfg.get("conta_email")
        if not conta_email:
            return "erro", (
                "Informe \"conta_email\" no config -- o e-mail da conta do painel web que vai "
                "receber as despesas geradas."
            )

        try:
            source = mp_reconcile.build_source(cfg, args)
        except Exception as e:
            return "erro", str(e)

        dias = args.dias or cfg.get("janela_dias") or 30
        print(f"Buscando e-mails do Mercado Pago dos últimos {dias} dia(s) em {cfg.get('email_address')}...")
        try:
            mensagens = fetch_mp_emails(cfg, dias)
        except Exception as e:
            return "erro", f"Falha ao buscar e-mails ({cfg.get('imap_server')}): {e}"
        print(f"{len(mensagens)} e-mail(is) do Mercado Pago encontrado(s) no período.")

        classifier = EmailClassifier(
            palavras_despesa=cfg.get("palavras_despesa_contendo"),
            palavras_receita=cfg.get("palavras_receita_contendo"),
            ignorar_sempre=cfg.get("ignorar_sempre_contendo"),
        )
        parser = EmailPaymentParser(classifier)

        mp_payments = []
        contagem_classes = {"despesa": 0, "receita": 0, "ignorar": 0, "desconhecido": 0, "sem_valor": 0}
        for msg in mensagens:
            payment, classe = parser.parse(msg)
            contagem_classes[classe] = contagem_classes.get(classe, 0) + 1
            if payment is not None:
                mp_payments.append(payment)

        try:
            db = source.read()
        except Exception as e:
            return "erro", f"Falha ao ler os dados do app ({source.describe()}): {e}"

        user = mp_expenses.find_user_by_email(db, conta_email)
        if not user:
            return "erro", f"Nenhum usuário com o e-mail '{conta_email}' encontrado em {source.describe()}."
        tenant_id = user.get("tenant_id")
        user_id = user.get("id")

        resultado = mp_expenses.generate_expenses(db, mp_payments, tenant_id, user_id, cfg)
        # Marca a origem (distingue de despesas geradas por mp_expenses.py via
        # API) -- os objetos em resultado["criadas"] são as MESMAS referências
        # já anexadas a db["expenses"], então isso também é gravado.
        for e in resultado["criadas"]:
            e["mercadoPagoSource"] = "email"
        n_criadas = len(resultado["criadas"])

        log(
            f"fonte={source.describe()} conta={conta_email} dias={dias} emails_encontrados={len(mensagens)} "
            f"classificados_despesa={contagem_classes['despesa']} classificados_receita={contagem_classes['receita']} "
            f"ignorados={contagem_classes['ignorar']} desconhecidos={contagem_classes['desconhecido']} "
            f"sem_valor={contagem_classes['sem_valor']} despesas_criadas={n_criadas} "
            f"categorias_novas={resultado['categorias_novas']} ignoradas_receita={resultado['ignoradas_receita']} "
            f"ignoradas_duplicadas={resultado['ignoradas_duplicadas']} ignoradas_filtro={resultado['ignoradas_filtro']}"
        )

        if args.dry_run:
            print("\n[dry-run] Nada foi gravado. Resumo do que seria feito:")
        elif n_criadas or resultado["categorias_novas"]:
            try:
                status = mp_reconcile.StatusTracker.update(
                    db, tenant_id, "last_expenses_email",
                    criadas=n_criadas,
                    categorias_novas=resultado["categorias_novas"],
                    ignoradas_receita=resultado["ignoradas_receita"],
                    ignoradas_duplicata_cruzada=resultado.get("ignoradas_duplicata_cruzada", 0),
                    emails_no_periodo=len(mensagens),
                    sem_valor=contagem_classes["sem_valor"],
                )
                source.write_fields({
                    "categories": db.get("categories", []),
                    "expenses": db.get("expenses", []),
                    "mercado_pago_status": status,
                })
            except Exception as e:
                return "erro", f"Falha ao gravar os dados de volta ({source.describe()}): {e}"

        linhas = [
            f"Fonte: {source.describe()} | Conta: {conta_email}",
            f"{len(mensagens)} e-mail(is) do Mercado Pago no período -> "
            f"{contagem_classes['despesa']} classificado(s) como despesa, "
            f"{contagem_classes['receita']} como receita da conta (ignorados), "
            f"{contagem_classes['ignorar']} ignorado(s) (cancelado/estornado/etc.), "
            f"{contagem_classes['desconhecido']} sem classificação reconhecida (ignorados por segurança).",
            f"{n_criadas} despesa(s) gerada(s) a partir dos e-mails do Mercado Pago"
            + (f" ({resultado['categorias_novas']} categoria(s) nova(s) criada(s))" if resultado["categorias_novas"] else "")
            + ".",
        ]
        for e in resultado["criadas"]:
            linhas.append(f"  - {e['date']} · R$ {e['amount']:.2f} · {e['description']}")
        if resultado["ignoradas_receita"]:
            linhas.append(
                f"{resultado['ignoradas_receita']} e-mail(is) ignorado(s) por já serem cobranças recebidas "
                "pela própria chave Pix do app (não são despesa)."
            )
        if resultado["ignoradas_duplicadas"]:
            linhas.append(f"{resultado['ignoradas_duplicadas']} e-mail(is) ignorado(s) por já terem sido importados antes.")
        if resultado.get("ignoradas_duplicata_cruzada"):
            linhas.append(
                f"{resultado['ignoradas_duplicata_cruzada']} e-mail(is) ignorado(s) por provável duplicata cruzada "
                "com uma despesa já gerada pelo outro caminho (API x e-mail, mesmo valor+data)."
            )
        if resultado["ignoradas_filtro"]:
            linhas.append(
                f"{resultado['ignoradas_filtro']} e-mail(is) ignorado(s) pelo filtro \"ignorar_descricoes_contendo\"."
            )
        if contagem_classes["sem_valor"]:
            linhas.append(
                f"{contagem_classes['sem_valor']} e-mail(is) classificado(s) como despesa, mas sem um valor "
                "\"R$ ...\" reconhecível no texto (revise manualmente)."
            )

        msg_final = "\n".join(linhas)
        icon = "✅" if n_criadas else "ℹ️"
        print(f"\n{icon} {msg_final}")

        return ("ok" if n_criadas else "sem_novidades"), msg_final


def run(args):
    return MercadoPagoEmailExpenseAgent().run(args)


def main():
    ap = argparse.ArgumentParser(
        description="Gera despesas no painel web a partir dos e-mails de notificação do Mercado Pago (sem precisar de Access Token)."
    )
    ap.add_argument("--config", default="mp_email_expenses_config.json", help="Caminho do config (veja mp_email_expenses_config.example.json)")
    ap.add_argument("--dias", type=int, default=None, help="Quantos dias para trás buscar e-mails (padrão: 30, ou \"janela_dias\" do config)")
    ap.add_argument("--firebase-service-account", dest="firebase_service_account", default=None, help="Sobrescreve \"firebase_service_account\" do config")
    ap.add_argument("--db-json", dest="db_json", default=None, help="Sobrescreve \"db_json\" do config (fonte alternativa sem Firebase)")
    ap.add_argument("--dry-run", dest="dry_run", action="store_true", help="Mostra o que seria gerado sem gravar nada")
    args = ap.parse_args()

    try:
        resultado, msg = run(args)
    except Exception:
        print("\n❌ ERRO ao gerar despesas a partir dos e-mails do Mercado Pago:")
        traceback.print_exc()
        log(f"ERRO: {traceback.format_exc()}")
        sys.exit(1)

    sys.exit(0 if resultado in ("ok", "sem_novidades") else 1)


if __name__ == "__main__":
    main()
