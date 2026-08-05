/* =============================================================
   js/receipt-ai.js
   "IA" de leitura de comprovante de transferência.

   Roda 100% no navegador: usa OCR (Tesseract.js, carregado sob
   demanda via CDN) para extrair o texto da imagem do comprovante
   enviado pelo usuário e, em seguida, aplica regras heurísticas
   para comparar o valor e o recebedor encontrados no texto com o
   pagamento pendente (assinatura de plano ou despesa extra),
   classificando a transferência em: Plano Free, Plano Premium,
   Despesa ou Outros.

   Importante (mesma transparência do restante do projeto): isto
   NÃO é uma integração bancária real nem um modelo de linguagem
   hospedado em servidor — é OCR + regex rodando no cliente. Serve
   como apoio para reduzir a confirmação "no clique cego", mas não
   é uma verificação antifraude à prova de falhas. Comprovantes
   ilegíveis, cortados ou adulterados podem não ser identificados
   corretamente; por isso a UI sempre permite envio manual para
   revisão quando a IA não consegue validar automaticamente.

   Reescrito em POO: OcrEngineLoader (carrega o Tesseract.js sob
   demanda) + ReceiptClassifier (heurística de classificação) +
   ReceiptAnalyzer (orquestra os dois). window.ReceiptAI continua
   existindo (mesma interface usada por js/dashboard.js:
   ReceiptAI.analyze/ReceiptAI.TYPE_LABELS).
   ============================================================= */

(function (global) {
  'use strict';

  var MERCHANT_CNPJ_DIGITS = '62904267000160';
  var MERCHANT_NAME = 'SPACECWORP';

  // Valores de referência conhecidos do sistema, usados para
  // classificar o comprovante quando o contexto da chamada não
  // define um "tipo esperado" explícito.
  var REFERENCE_AMOUNTS = [
    { type: 'plano_premium', amount: 19.99 },
    { type: 'despesa', amount: 5.0 }
  ];

  var TYPE_LABELS = {
    plano_free: 'Plano Free',
    plano_premium: 'Plano Premium',
    despesa: 'Despesa',
    outros: 'Outros'
  };

  var TESSERACT_CDN_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

  function stripAccents(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function onlyDigits(s) {
    return String(s || '').replace(/\D+/g, '');
  }

  function onlyLetters(s) {
    return stripAccents(String(s || '')).toUpperCase().replace(/[^A-Z]/g, '');
  }

  function closeEnough(a, b, tol) {
    tol = tol == null ? 0.05 : tol;
    return Math.abs(a - b) <= tol;
  }

  class OcrEngineLoader {
    constructor(cdnUrl) {
      this.cdnUrl = cdnUrl;
      this._pending = null;
    }

    load() {
      if (global.Tesseract) return Promise.resolve(global.Tesseract);
      if (this._pending) return this._pending;

      var cdnUrl = this.cdnUrl;
      this._pending = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = cdnUrl;
        script.async = true;
        script.onload = function () {
          if (global.Tesseract) resolve(global.Tesseract);
          else reject(new Error('Motor de OCR carregado, mas indisponível.'));
        };
        script.onerror = function () {
          reject(new Error('Não foi possível carregar o motor de OCR (verifique sua conexão).'));
        };
        document.head.appendChild(script);
      });

      return this._pending;
    }
  }

  class ReceiptClassifier {
    constructor(referenceAmounts) {
      this.referenceAmounts = referenceAmounts;
    }

    // Extrai valores monetários no formato brasileiro (1.234,56 ou 12,34)
    // presentes no texto reconhecido pelo OCR.
    parseAmounts(text) {
      var results = [];
      var re = /\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g;
      var matches = String(text || '').match(re) || [];
      for (var i = 0; i < matches.length; i++) {
        var raw = matches[i].replace(/\./g, '').replace(',', '.');
        var val = parseFloat(raw);
        if (!isNaN(val)) results.push(val);
      }
      return results;
    }

    classify(text, amounts, merchantMatches, ctx) {
      var upper = onlyLetters(text);
      var expected = ctx.expectedAmount;
      var expectedType = ctx.expectedType;

      var amountMatches = false;
      var detectedAmount = amounts.length ? amounts[0] : null;

      if (expected != null && amounts.length) {
        for (var i = 0; i < amounts.length; i++) {
          if (closeEnough(amounts[i], expected)) {
            amountMatches = true;
            detectedAmount = amounts[i];
            break;
          }
        }
      }

      var classification = 'outros';

      if (amountMatches && expectedType) {
        classification = expectedType;
      } else if (detectedAmount != null) {
        for (var j = 0; j < this.referenceAmounts.length; j++) {
          if (closeEnough(detectedAmount, this.referenceAmounts[j].amount)) {
            classification = this.referenceAmounts[j].type;
            break;
          }
        }
      }

      if (classification === 'outros') {
        if (upper.indexOf('PREMIUM') !== -1) classification = 'plano_premium';
        else if (upper.indexOf('GRATIS') !== -1 || upper.indexOf('FREE') !== -1) classification = 'plano_free';
        else if (upper.indexOf('DESPESA') !== -1) classification = 'despesa';
      }

      var confidence = 0;
      if (merchantMatches) confidence += 0.5;
      if (amountMatches) confidence += 0.4;
      if (classification !== 'outros') confidence += 0.1;

      return {
        amountMatches: amountMatches,
        detectedAmount: detectedAmount,
        classification: classification,
        confidence: Math.min(1, confidence)
      };
    }
  }

  class ReceiptAnalyzer {
    constructor(ocrLoader, classifier, merchantCnpjDigits, merchantName) {
      this.ocrLoader = ocrLoader;
      this.classifier = classifier;
      this.merchantCnpjDigits = merchantCnpjDigits;
      this.merchantName = merchantName;
    }

    /**
     * Lê e valida um comprovante de transferência.
     *
     * file: File (imagem) selecionada pelo usuário no <input type="file">
     * ctx:
     *   expectedAmount  valor (number) que deveria constar no comprovante
     *   expectedType    'plano_free' | 'plano_premium' | 'despesa' — usado
     *                    como classificação quando o valor bate
     *
     * Resolve com:
     *   {
     *     ok: true,
     *     rawText,          texto bruto extraído pelo OCR
     *     merchantMatches,  true se o CNPJ/nome do recebedor foi encontrado
     *     amountMatches,    true se algum valor do comprovante bate com expectedAmount
     *     detectedAmount,   valor identificado (ou null)
     *     classification,   'plano_free' | 'plano_premium' | 'despesa' | 'outros'
     *     confidence        0..1
     *   }
     */
    analyze(file, ctx) {
      ctx = ctx || {};
      if (!file) return Promise.reject(new Error('Nenhum arquivo selecionado.'));

      var self = this;
      return this.ocrLoader
        .load()
        .then(function (Tesseract) {
          return Tesseract.recognize(file, 'por');
        })
        .then(function (result) {
          var text = (result && result.data && result.data.text) || '';
          var digits = onlyDigits(text);
          var letters = onlyLetters(text);

          var merchantMatches =
            digits.indexOf(self.merchantCnpjDigits) !== -1 || letters.indexOf(self.merchantName) !== -1;

          var amounts = self.classifier.parseAmounts(text);
          var c = self.classifier.classify(text, amounts, merchantMatches, ctx);

          return {
            ok: true,
            rawText: text,
            merchantMatches: merchantMatches,
            amountMatches: c.amountMatches,
            detectedAmount: c.detectedAmount,
            classification: c.classification,
            confidence: c.confidence
          };
        });
    }
  }

  var receiptAnalyzer = new ReceiptAnalyzer(
    new OcrEngineLoader(TESSERACT_CDN_URL),
    new ReceiptClassifier(REFERENCE_AMOUNTS),
    MERCHANT_CNPJ_DIGITS,
    MERCHANT_NAME
  );

  global.ReceiptAI = {
    analyze: function (file, ctx) { return receiptAnalyzer.analyze(file, ctx); },
    TYPE_LABELS: TYPE_LABELS
  };
})(window);
