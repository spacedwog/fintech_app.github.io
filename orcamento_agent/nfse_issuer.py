#!/usr/bin/env python3
"""
Agente de emissão de Nota Fiscal de Serviço eletrônica (NFS-e) real, para os
pagamentos já registrados pelo painel web (dashboard.html) -- assinaturas de
plano e "despesas extras" cobradas via Pix (ver PIX_MERCHANT em js/dashboard.js,
histórico em Api.listPayments/js/api.js).

LEIA ANTES DE USAR -- por que isto roda fora do navegador, e o que NÃO faz
sozinho:
  O site (fintech_app.github.io) é 100% estático: não existe servidor, e um
  token de um provedor de emissão fiscal (aqui, Focus NFe -- focusnfe.com.br)
  NUNCA pode ir para o navegador/site público, pelo mesmo motivo do Access
  Token do Mercado Pago (ver mp_reconcile.py/mp_expenses.py). Por isso este
  script roda só localmente (manual ou agendado, ex.: GitHub Actions), no
  mesmo espírito dos outros agentes desta pasta.

  Emitir uma nota fiscal de verdade também exige, além deste script:
    1) Uma conta contratada num provedor real de emissão (referência aqui:
       Focus NFe -- github doc.focusnfe.com.br). Este script só implementa
       o cliente da Focus NFe; outro provedor exigiria um cliente equivalente.
    2) Um certificado digital e-CNPJ (modelo A1) válido, cadastrado NO
       PROVEDOR (não neste script -- a Focus NFe assina a nota por você a
       partir do certificado que você sobe no painel dela).
    3) Os dados tributários corretos do seu enquadramento (regime tributário,
       alíquota de ISS, código de serviço/tributação municipal de Osasco/SP)
       -- ver nfse_config.example.json e CONFIRME COM SEU CONTADOR. Este
       script NÃO calcula tributos nem valida enquadramento fiscal.
    4) O CPF/CNPJ do tomador (seu cliente) cadastrado no perfil dele (tela
       Configurações do painel -- ver Api.updateProfile em js/api.js). Sem
       isso, o pagamento fica com nfseStatus "aguardando_documento_tomador"
       e NÃO é enviado para emissão (não inventamos documento de ninguém).

  Rode SEMPRE primeiro com "ambiente": "homologacao" no config (é o padrão
  do nfse_config.example.json) -- homologação simula a emissão sem gerar
  nota fiscal real e sem custo. Só troque para "producao" depois de validar
  o fluxo inteiro (e com o certificado/dados fiscais corretos).

Uso:
  python3 nfse_issuer.py                              (processa pendentes, grava)
  python3 nfse_issuer.py --dry-run                     (mostra o que faria, não chama a API nem grava)
  python3 nfse_issuer.py --limite 5
  python3 nfse_issuer.py --config outro_config.json
  python3 nfse_issuer.py --firebase-service-account chave.json
  python3 nfse_issuer.py --db-json copia_local_do_banco.json

Fonte dos dados do app (configure UMA das duas em nfse_config.json -- veja
nfse_config.example.json): "firebase_service_account" (recomendado, mesmo
Firestore do painel) ou "db_json" (cópia local).

⚠️ Segurança: o token da Focus NFe e a chave de conta de serviço do Firebase
são segredos que dão acesso real (o token pode emitir notas fiscais em seu
nome, com custo). Nunca versione nfse_config.json nem a chave do Firebase
(ver .gitignore). Se vazarem, revogue-os imediatamente no painel do provedor.

Requer: pip install requests --break-system-packages e, só se for usar o
Firestore como fonte, firebase-admin (pip install firebase-admin --break-system-packages).

Reescrito em POO, no mesmo espírito de mp_reconcile.py: PaymentDataSource
(FirestoreSource/LocalJsonSource) para ler/gravar o banco do painel,
FocusNfeClient para falar com a API real do provedor, TomadorValidator para
decidir se um pagamento tem dados suficientes para emitir, e NfseIssuingAgent
para orquestrar tudo em run().
"""
import argparse
import abc
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone


# ---------- log (best-effort, nunca derruba o script) ----------

def log(linha):
    try:
        base = os.path.dirname(os.path.abspath(__file__))
        logdir = os.path.join(base, "logs")
        os.makedirs(logdir, exist_ok=True)
        with open(os.path.join(logdir, "nfse_issuer.log"), "a", encoding="utf-8") as f:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            f.write(f"[{ts}] {linha}\n")
    except Exception:
        pass


# ---------- fontes de dados do app (Firestore ou db.json local) ----------
# Mesmo contrato/implementação de mp_reconcile.py -- duplicado aqui de
# propósito (cada agente desta pasta é standalone: dá para copiar só um
# arquivo para rodar em outro lugar, sem depender dos demais).

class PaymentDataSource(abc.ABC):
    @abc.abstractmethod
    def read(self):
        raise NotImplementedError

    @abc.abstractmethod
    def write_fields(self, fields):
        raise NotImplementedError

    @abc.abstractmethod
    def describe(self):
        raise NotImplementedError


class FirestoreSource(PaymentDataSource):
    COLLECTION = "fintech_saas"
    DOC_ID = "db_v1"

    def __init__(self, service_account_path):
        try:
            import firebase_admin
            from firebase_admin import credentials, firestore
        except ImportError:
            raise RuntimeError(
                "Falta o pacote 'firebase-admin'. Rode: pip install firebase-admin --break-system-packages"
            )
        if not firebase_admin._apps:
            cred = credentials.Certificate(service_account_path)
            firebase_admin.initialize_app(cred)
        self._client = firestore.client()
        self._ref = self._client.collection(self.COLLECTION).document(self.DOC_ID)

    def read(self):
        snap = self._ref.get()
        if not snap.exists:
            raise RuntimeError(
                f"Documento {self.COLLECTION}/{self.DOC_ID} ainda não existe no Firestore "
                "(nenhum dado foi sincronizado pelo app ainda)."
            )
        return snap.to_dict()

    def write_fields(self, fields):
        self._ref.update(fields)

    def describe(self):
        return f"Firestore ({self.COLLECTION}/{self.DOC_ID})"


class LocalJsonSource(PaymentDataSource):
    def __init__(self, path):
        self.path = path

    def read(self):
        if not os.path.exists(self.path):
            raise FileNotFoundError(f"Arquivo não encontrado: {self.path}")
        with open(self.path, encoding="utf-8") as f:
            return json.load(f)

    def write_fields(self, fields):
        db = self.read()
        db.update(fields)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=2)

    def describe(self):
        return f"db.json local ({self.path})"


class DataSourceFactory:
    @staticmethod
    def build(cfg, args):
        sa_path = args.firebase_service_account or cfg.get("firebase_service_account")
        if sa_path:
            if not os.path.exists(sa_path):
                raise RuntimeError(f"Chave de conta de serviço do Firebase não encontrada: {sa_path}")
            return FirestoreSource(sa_path)

        db_json = args.db_json or cfg.get("db_json")
        if db_json:
            return LocalJsonSource(db_json)

        raise RuntimeError(
            "Nenhuma fonte de dados configurada. Defina \"firebase_service_account\" (recomendado) ou "
            "\"db_json\" em nfse_config.json -- veja nfse_config.example.json."
        )


# ---------- TomadorValidator: decide se um pagamento tem dado suficiente
# para emitir NFS-e (nunca inventa CPF/CNPJ/nome de ninguém) ----------

class TomadorValidator:
    @staticmethod
    def find_user(db, user_id):
        return next((u for u in db.get("users", []) if u.get("id") == user_id), None)

    @classmethod
    def tomador_ou_motivo(cls, db, payment):
        """Devolve (tomador_dict, None) se o pagamento tem dados suficientes
        do tomador, ou (None, motivo) se não -- motivo vira o nfseStatus de
        pendência gravado no pagamento (nunca uma emissão com dado inventado)."""
        user = cls.find_user(db, payment.get("user_id"))
        if not user:
            return None, "usuario_nao_encontrado"

        documento = "".join(ch for ch in str(user.get("tax_document") or "") if ch.isdigit())
        if len(documento) not in (11, 14):
            return None, "aguardando_documento_tomador"

        nome = (user.get("name") or "").strip()
        email = (user.get("email") or "").strip()
        if not nome or not email:
            return None, "aguardando_dados_tomador"

        return {
            "tipo": "pessoa_fisica" if len(documento) == 11 else "pessoa_juridica",
            "documento": documento,
            "nome": nome,
            "email": email,
        }, None


# ---------- FocusNfeClient: cliente real da API da Focus NFe ----------
# Referência: doc.focusnfe.com.br. A API é assíncrona (emitir() dispara o
# processamento; consultar() é chamado em polling até sair de
# "processando_autorizacao"). Confirme nomes de campos/endpoints atuais na
# documentação antes de usar em produção -- provedores de emissão fiscal
# atualizam esses detalhes com alguma frequência (ex.: adesão à NFS-e
# Nacional em cada município).

class FocusNfeClient:
    BASE_URLS = {
        "homologacao": "https://homologacao.focusnfe.com.br",
        "producao": "https://api.focusnfe.com.br",
    }

    def __init__(self, token, ambiente):
        try:
            import requests
        except ImportError:
            raise RuntimeError("Falta o pacote 'requests'. Rode: pip install requests --break-system-packages")
        self._requests = requests
        self.token = token
        self.ambiente = ambiente
        self.base_url = self.BASE_URLS.get(ambiente, self.BASE_URLS["homologacao"])

    def _auth(self):
        return (self.token, "")  # Basic Auth: token como usuário, senha vazia

    def emitir(self, ref, payload):
        """POST /v2/nfse?ref=... -- dispara a emissão (assíncrona). Devolve o
        JSON de resposta (normalmente {"status": "processando_autorizacao", ...})."""
        resp = self._requests.post(
            f"{self.base_url}/v2/nfse", params={"ref": ref}, json=payload, auth=self._auth(), timeout=30
        )
        try:
            data = resp.json()
        except ValueError:
            data = {"status": "erro_autorizacao", "mensagem": resp.text}
        if resp.status_code >= 500:
            raise RuntimeError(f"Focus NFe respondeu erro {resp.status_code}: {resp.text[:300]}")
        return data

    def consultar(self, ref):
        """GET /v2/nfse/{ref} -- status atual da nota (polling)."""
        resp = self._requests.get(f"{self.base_url}/v2/nfse/{ref}", auth=self._auth(), timeout=30)
        try:
            return resp.json()
        except ValueError:
            return {"status": "erro_autorizacao", "mensagem": resp.text}


# ---------- NfsePayloadBuilder: monta o payload a partir do payment/config ----------

class NfsePayloadBuilder:
    def __init__(self, cfg):
        self.prestador = cfg.get("prestador", {})
        self.servico = cfg.get("servico", {})

    def build(self, payment, tomador):
        hoje = datetime.now().strftime("%Y-%m-%d")
        descricao = payment.get("type") == "plano" and (
            f"Assinatura do plano {payment.get('plan') or ''} - Fintech Spacecworp"
        ) or self.servico.get("discriminacao_padrao", "Servico Fintech Spacecworp")

        payload = {
            "data_emissao": hoje,
            "prestador": {
                "cnpj": self.prestador.get("cnpj"),
                "inscricao_municipal": self.prestador.get("inscricao_municipal"),
                "codigo_municipio": self.prestador.get("codigo_municipio"),
            },
            "tomador": {
                "cpf" if tomador["tipo"] == "pessoa_fisica" else "cnpj": tomador["documento"],
                "razao_social": tomador["nome"],
                "email": tomador["email"],
            },
            "servico": {
                "item_lista_servico": self.servico.get("item_lista_servico"),
                "codigo_tributario_municipio": self.servico.get("codigo_tributario_municipio"),
                "discriminacao": descricao,
                "iss_retido": bool(self.servico.get("iss_retido", False)),
                "valor_servicos": payment.get("amount"),
                "aliquota": self.servico.get("aliquota"),
            },
        }
        return payload


# ---------- NfseIssuingAgent: orquestra tudo ----------

class NfseIssuingAgent:
    # nfseStatus que já significam "não mandar de novo para a API".
    STATUS_FINAIS = {"emitida", "cancelada"}

    def _pending_payments(self, db, limite):
        pendentes = []
        for p in db.get("payments", []):
            status = p.get("nfseStatus")
            if status in self.STATUS_FINAIS:
                continue
            if not p.get("amount") or p.get("amount") <= 0:
                continue
            pendentes.append(p)
        return pendentes[:limite]

    def _poll_until_done(self, client, ref, max_tentativas, intervalo):
        for tentativa in range(max_tentativas):
            resultado = client.consultar(ref)
            status = resultado.get("status")
            if status not in ("processando_autorizacao", None):
                return resultado
            time.sleep(intervalo)
        return {"status": "processando_autorizacao", "mensagem": "limite de tentativas de consulta atingido"}

    def run(self, args):
        if not os.path.exists(args.config):
            return "erro", (
                f"Config não encontrado: {args.config}. Copie nfse_config.example.json -> {args.config} "
                "e preencha o token da Focus NFe + os dados do prestador/serviço."
            )

        with open(args.config, encoding="utf-8") as f:
            cfg = json.load(f)

        token = cfg.get("focus_nfe_token")
        if not token or str(token).startswith("COLE_"):
            return "erro", "Token da Focus NFe não configurado em nfse_config.json."

        ambiente = cfg.get("ambiente", "homologacao")
        limite = args.limite or cfg.get("limite_por_execucao") or 20
        max_tentativas = cfg.get("max_tentativas_polling", 8)
        intervalo = cfg.get("intervalo_polling_segundos", 5)

        try:
            source = DataSourceFactory.build(cfg, args)
        except Exception as e:
            return "erro", str(e)

        try:
            db = source.read()
        except Exception as e:
            return "erro", f"Falha ao ler os dados do app ({source.describe()}): {e}"

        pendentes = self._pending_payments(db, limite)
        if not pendentes:
            msg = "Nenhum pagamento pendente de nota fiscal."
            log(f"fonte={source.describe()} pendentes=0")
            return "sem_pendencias", msg

        try:
            client = FocusNfeClient(token, ambiente)
            builder = NfsePayloadBuilder(cfg)
        except Exception as e:
            return "erro", str(e)

        now_iso = datetime.now(timezone.utc).isoformat()
        resumo = {"emitidas": [], "pendentes_documento": [], "erros": [], "ainda_processando": []}

        for payment in pendentes:
            tomador, motivo = TomadorValidator.tomador_ou_motivo(db, payment)
            if not tomador:
                payment["nfseStatus"] = motivo
                payment["nfseCheckedAt"] = now_iso
                resumo["pendentes_documento"].append({"payment_id": payment.get("id"), "motivo": motivo})
                continue

            ref = payment.get("nfseRef") or f"pagamento-{payment.get('id')}"
            payment["nfseRef"] = ref
            payload = builder.build(payment, tomador)

            if args.dry_run:
                resumo["emitidas"].append({"payment_id": payment.get("id"), "ref": ref, "dry_run": True})
                continue

            try:
                resultado = client.emitir(ref, payload)
                if resultado.get("status") == "processando_autorizacao":
                    resultado = self._poll_until_done(client, ref, max_tentativas, intervalo)
            except Exception as e:
                payment["nfseStatus"] = "erro"
                payment["nfseErro"] = str(e)
                payment["nfseCheckedAt"] = now_iso
                resumo["erros"].append({"payment_id": payment.get("id"), "erro": str(e)})
                continue

            status = resultado.get("status")
            payment["nfseCheckedAt"] = now_iso
            payment["nfseProvider"] = "focus_nfe"
            payment["nfseAmbiente"] = ambiente

            if status == "autorizado":
                payment["nfseStatus"] = "emitida"
                payment["nfseNumero"] = resultado.get("numero")
                payment["nfseCodigoVerificacao"] = resultado.get("codigo_verificacao")
                payment["nfsePdfUrl"] = resultado.get("url") or resultado.get("caminho_pdf_nota_fiscal")
                payment["nfseXmlUrl"] = resultado.get("caminho_xml_nota_fiscal")
                payment["nfseEmitidaEm"] = now_iso
                resumo["emitidas"].append({"payment_id": payment.get("id"), "numero": payment["nfseNumero"]})
            elif status == "processando_autorizacao":
                payment["nfseStatus"] = "emitindo"
                resumo["ainda_processando"].append({"payment_id": payment.get("id"), "ref": ref})
            else:
                payment["nfseStatus"] = "erro"
                payment["nfseErro"] = resultado.get("mensagem") or resultado.get("erros") or json.dumps(resultado)[:500]
                resumo["erros"].append({"payment_id": payment.get("id"), "erro": payment["nfseErro"]})

        n_emitidas = len(resumo["emitidas"])
        n_pendentes_doc = len(resumo["pendentes_documento"])
        n_erros = len(resumo["erros"])
        n_processando = len(resumo["ainda_processando"])

        log(
            f"fonte={source.describe()} ambiente={ambiente} emitidas={n_emitidas} "
            f"pendentes_documento={n_pendentes_doc} erros={n_erros} ainda_processando={n_processando}"
        )

        if args.dry_run:
            linhas = [f"[dry-run] Nada foi enviado à Focus NFe nem gravado. {len(pendentes)} pagamento(s) seriam processados:"]
        else:
            try:
                source.write_fields({"payments": db["payments"]})
            except Exception as e:
                return "erro", f"Falha ao gravar os dados de volta ({source.describe()}): {e}"
            linhas = [f"Fonte: {source.describe()} (ambiente: {ambiente})", f"{n_emitidas} nota(s) fiscal(is) emitida(s)."]

        for e in resumo["emitidas"]:
            linhas.append(f"  - pagamento #{e['payment_id']}" + (f" -> NFS-e nº {e.get('numero')}" if e.get("numero") else " (dry-run)"))
        if n_pendentes_doc:
            linhas.append(f"⚠️  {n_pendentes_doc} pagamento(s) aguardando CPF/CNPJ do cliente (tela Configurações no painel).")
        if n_processando:
            linhas.append(f"⏳ {n_processando} nota(s) ainda em processamento na Focus NFe -- tente de novo na próxima execução.")
        if n_erros:
            linhas.append(f"❌ {n_erros} erro(s) na emissão -- revise nfse_config.json (dados fiscais) e os detalhes abaixo:")
            for e in resumo["erros"]:
                linhas.append(f"  - pagamento #{e['payment_id']}: {e['erro']}")

        msg = "\n".join(linhas)
        icon = "✅" if n_emitidas and not n_erros else ("⚠️" if n_erros or n_pendentes_doc else "ℹ️")
        print(f"\n{icon} {msg}")

        resultado_final = "erro" if n_erros and not n_emitidas else "ok"
        return resultado_final, msg


def run(args):
    return NfseIssuingAgent().run(args)


def main():
    ap = argparse.ArgumentParser(
        description="Emite Nota Fiscal de Serviço (NFS-e) real via Focus NFe para pagamentos pendentes do painel web."
    )
    ap.add_argument("--config", default="nfse_config.json", help="Caminho do config (veja nfse_config.example.json)")
    ap.add_argument("--limite", type=int, default=None, help="Quantos pagamentos pendentes processar nesta execução (padrão: do config, ou 20)")
    ap.add_argument("--firebase-service-account", dest="firebase_service_account", default=None, help="Sobrescreve \"firebase_service_account\" do config")
    ap.add_argument("--db-json", dest="db_json", default=None, help="Sobrescreve \"db_json\" do config (fonte alternativa sem Firebase)")
    ap.add_argument("--dry-run", dest="dry_run", action="store_true", help="Mostra o que seria emitido sem chamar a Focus NFe nem gravar nada")
    args = ap.parse_args()

    try:
        resultado, msg = run(args)
    except Exception:
        print("\n❌ ERRO ao emitir nota(s) fiscal(is):")
        traceback.print_exc()
        log(f"ERRO: {traceback.format_exc()}")
        sys.exit(1)

    sys.exit(0 if resultado in ("ok", "sem_pendencias") else 1)


if __name__ == "__main__":
    main()
