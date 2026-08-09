/* =============================================================
   js/mercado-pago-agent.js
   AgentIA local para extrair transferências do extrato do cartão
   Mercado Pago e converter em despesas prontas para lançamento.
   ============================================================= */

(function (global) {
  "use strict";

  function stripAccents(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function normalize(s) {
    return stripAccents(String(s || "")).toLowerCase().trim();
  }

  function parseAmount(raw) {
    if (raw == null) return null;
    var s = String(raw).replace(/\s+/g, "").replace(/^R\$/i, "");
    if (/,\d{2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    s = s.replace(/[^\d.\-]/g, "");
    var n = parseFloat(s);
    if (!isFinite(n) || n === 0) return null;
    if (n < 0) n = Math.abs(n);
    return n;
  }

  function parseDate(raw) {
    var s = String(raw || "").trim();
    var m1 = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (m1) return m1[0];
    var m2 = s.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    if (!m2) return null;
    return m2[3] + "-" + m2[2] + "-" + m2[1];
  }

  function cleanDescription(line, dateToken, amountToken) {
    var text = String(line || "");
    if (dateToken) text = text.replace(dateToken, " ");
    if (amountToken) text = text.replace(amountToken, " ");
    text = text.replace(/[;|]+/g, " ").replace(/\s{2,}/g, " ").trim();
    return text || "Transferência Mercado Pago";
  }

  function isCreditLike(line) {
    var n = normalize(line);
    return n.includes("credito") || n.includes("crédito") || n.includes("receb") || n.includes("estorno");
  }

  function pickFirst(obj, keys) {
    if (!obj || !keys || !keys.length) return null;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v != null && String(v).trim() !== "") return v;
    }
    return null;
  }

  function normalizeAmountCandidate(raw) {
    if (raw == null) return null;
    if (typeof raw === "object") {
      return pickFirst(raw, ["amount", "value", "valor"]);
    }
    return raw;
  }

  function isDebitLikeRecord(item) {
    var direction = normalize(
      pickFirst(item, [
        "credit_debit_type",
        "creditDebitType",
        "type",
        "operation_type",
        "transaction_type",
        "entry_type",
        "nature",
      ])
    );
    if (!direction) return true;
    if (
      direction.includes("credit") ||
      direction.includes("entrada") ||
      direction.includes("receb") ||
      direction.includes("deposit") ||
      direction.includes("inflow") ||
      direction.includes("estorno")
    ) {
      return false;
    }
    return true;
  }

  function isApprovedLikeRecord(item) {
    var status = normalize(pickFirst(item, ["status", "transaction_status", "payment_status", "state"]));
    if (!status) return true;
    return (
      status === "approved" ||
      status === "accredited" ||
      status === "settled" ||
      status === "completed" ||
      status === "success" ||
      status === "succeeded" ||
      status === "posted"
    );
  }

  function extractRowsFromJsonPayload(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_err) {
      return { rows: [], skipped: 0 };
    }

    var list = [];
    if (Array.isArray(parsed)) list = parsed;
    else if (parsed && typeof parsed === "object") {
      list = parsed.results || parsed.data || parsed.payments || parsed.transactions || parsed.items || [];
      if (!Array.isArray(list)) list = [];
    }

    var rows = [];
    var skipped = 0;
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};

      if (!isApprovedLikeRecord(item) || !isDebitLikeRecord(item)) {
        skipped++;
        continue;
      }

      var amountRaw = normalizeAmountCandidate(
        pickFirst(item, ["amount", "transaction_amount", "value", "valor", "amount_in_local_currency"])
      );
      var amount = parseAmount(amountRaw);
      if (!amount) {
        skipped++;
        continue;
      }

      var date = parseDate(
        pickFirst(item, [
          "date",
          "date_approved",
          "dateApproved",
          "date_created",
          "created_at",
          "approved_at",
          "transaction_date",
          "booking_date",
          "datetime",
        ])
      );
      if (!date) date = new Date().toISOString().slice(0, 10);

      var desc = String(
        pickFirst(item, [
          "description",
          "desc",
          "statement_description",
          "detail",
          "concept",
          "merchant_name",
          "counterparty",
          "title",
        ]) || "Transferência Mercado Pago"
      ).trim();

      rows.push({
        amount: amount,
        date: date,
        description: desc,
        categoryName: guessCategory(desc),
      });
    }

    return { rows: rows, skipped: skipped };
  }

  function guessCategory(description) {
    var n = normalize(description);
    if (/(uber|99|taxi|metr|onibus|ônibus|combustivel|combustível|posto|pedagio|pedágio|transporte)/.test(n)) return "Transporte";
    if (/(ifood|restaurante|mercado|supermercado|padaria|lanche|aliment)/.test(n)) return "Alimentação";
    if (/(farmacia|farmácia|medic|consulta|saude|saúde|hospital)/.test(n)) return "Saúde";
    if (/(aluguel|condominio|condomínio|energia|luz|agua|água|internet|moradia)/.test(n)) return "Moradia";
    if (/(cinema|show|streaming|lazer|jogo|viagem)/.test(n)) return "Lazer";
    return "Outros";
  }

  class MercadoPagoTransferAgent {
    analyze(input, ctx) {
      ctx = ctx || {};
      var text = String(input || "").trim();
      if (!text) throw new Error("Cole as transferências para o AgentIA analisar.");

      var rows = [];
      var skipped = 0;

      if (text[0] === "[" || text[0] === "{") {
        var jsonParsed = extractRowsFromJsonPayload(text);
        rows = jsonParsed.rows || [];
        skipped = jsonParsed.skipped || 0;
      }

      if (!rows.length) {
        var lines = text.split(/\r?\n/);
        for (var j = 0; j < lines.length; j++) {
          var line = lines[j].trim();
          if (!line) continue;
          if (isCreditLike(line)) {
            skipped++;
            continue;
          }

          var amountMatches = line.match(/-?\s*R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}|-?\s*R?\$?\s*\d+[.,]\d{2}/gi) || [];
          var amountToken = amountMatches.length ? amountMatches[amountMatches.length - 1] : null;
          var amountValue = parseAmount(amountToken);
          if (!amountValue) {
            skipped++;
            continue;
          }

          var dateToken = parseDate(line);
          var dateValue = dateToken || new Date().toISOString().slice(0, 10);
          var descValue = cleanDescription(line, dateToken, amountToken);
          rows.push({
            amount: amountValue,
            date: dateValue,
            description: descValue,
            categoryName: guessCategory(descValue),
          });
        }
      }

      if (!rows.length) {
        throw new Error("Não foi possível identificar transferências válidas no texto informado.");
      }

      var cardLabelParts = [];
      if (ctx.cardHolder) cardLabelParts.push(ctx.cardHolder);
      if (ctx.cardBrand) cardLabelParts.push(ctx.cardBrand);
      if (ctx.cardLast4) cardLabelParts.push("•••• " + String(ctx.cardLast4));
      var cardLabel = cardLabelParts.join(" · ");

      return {
        rows: rows.map(function (r) {
          return Object.assign({}, r, {
            description: cardLabel ? "[Mercado Pago " + cardLabel + "] " + r.description : "[Mercado Pago] " + r.description,
          });
        }),
        skipped: skipped,
      };
    }
  }

  global.MercadoPagoAgentIA = new MercadoPagoTransferAgent();
})(window);
