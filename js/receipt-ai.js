/* =============================================================
   js/receipt-ai.js
   "IA" de leitura de comprovante de transferência.

   Roda 100% no navegador: usa OCR (Tesseract.js, carregado sob
   demanda via CDN) para extrair o texto do comprovante enviado
   pelo usuário e, em seguida, aplica regras heurísticas para
   comparar o valor e o recebedor encontrados no texto com o
   pagamento pendente (assinatura de plano ou despesa extra),
   classificando a transferência em: Plano Free, Plano Premium,
   Despesa ou Outros.

   Formatos aceitos: imagens .png/.jpg/.jpeg (lidas diretamente
   pelo OCR) e .pdf (a 1ª página é renderizada num <canvas> via
   PDF.js, carregado sob demanda via CDN, e esse canvas é que vai
   para o OCR — o mesmo motor de OCR das imagens).

   Importante (mesma transparência do restante do projeto): isto
   NÃO é uma integração bancária real nem um modelo de linguagem
   hospedado em servidor — é OCR + regex rodando no cliente. Serve
   como apoio para reduzir a confirmação "no clique cego", mas não
   é uma verificação antifraude à prova de falhas. Comprovantes
   ilegíveis, cortados ou adulterados podem não ser identificados
   corretamente; por isso a UI sempre permite envio manual para
   revisão quando a IA não consegue validar automaticamente.

   Reescrito em POO: OcrEngineLoader (carrega o Tesseract.js sob
   demanda) + PdfEngineLoader/PdfPageRenderer (carrega o PDF.js sob
   demanda e rasteriza a 1ª página de um PDF) + ReceiptClassifier
   (heurística de classificação) + ReceiptAnalyzer (orquestra
   tudo). window.ReceiptAI continua existindo (mesma interface
   usada por js/dashboard.js: ReceiptAI.analyze/ReceiptAI.TYPE_LABELS).
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

  // Build "legacy" do PDF.js: expõe window.pdfjsLib via <script> normal,
  // sem precisar de <script type="module">.
  var PDFJS_CDN_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js';
  var PDFJS_WORKER_CDN_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';

  // Extensões/MIME types aceitos no upload do comprovante.
  var SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'pdf'];

  function fileExtension(file) {
    var name = (file && file.name) || '';
    var match = /\.([a-z0-9]+)$/i.exec(name);
    return match ? match[1].toLowerCase() : '';
  }

  // Classifica o arquivo enviado em 'image', 'pdf' ou 'unsupported',
  // olhando tanto o MIME type quanto a extensão (alguns navegadores/SOs
  // não preenchem file.type corretamente para todo tipo de arquivo).
  function detectFileKind(file) {
    var type = ((file && file.type) || '').toLowerCase();
    var ext = fileExtension(file);

    if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (type.indexOf('image/') === 0 || ext === 'png' || ext === 'jpg' || ext === 'jpeg') return 'image';
    return 'unsupported';
  }

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

  // Carrega o PDF.js sob demanda (mesmo padrão do OcrEngineLoader) e
  // aponta o worker para a mesma versão via CDN.
  class PdfEngineLoader {
    constructor(cdnUrl, workerUrl) {
      this.cdnUrl = cdnUrl;
      this.workerUrl = workerUrl;
      this._pending = null;
    }

    load() {
      if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
      if (this._pending) return this._pending;

      var cdnUrl = this.cdnUrl;
      var workerUrl = this.workerUrl;
      this._pending = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = cdnUrl;
        script.async = true;
        script.onload = function () {
          if (global.pdfjsLib) {
            global.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
            resolve(global.pdfjsLib);
          } else {
            reject(new Error('Motor de leitura de PDF carregado, mas indisponível.'));
          }
        };
        script.onerror = function () {
          reject(new Error('Não foi possível carregar o motor de leitura de PDF (verifique sua conexão).'));
        };
        document.head.appendChild(script);
      });

      return this._pending;
    }
  }

  // Rasteriza a 1ª página de um PDF num <canvas>, que é então entregue ao
  // mesmo motor de OCR (Tesseract.js) usado nas imagens — o Tesseract.js
  // aceita HTMLCanvasElement diretamente como entrada.
  class PdfPageRenderer {
    constructor(pdfEngineLoader) {
      this.pdfEngineLoader = pdfEngineLoader;
    }

    renderFirstPageToCanvas(file) {
      return this.pdfEngineLoader
        .load()
        .then(function (pdfjsLib) {
          return file.arrayBuffer().then(function (buffer) {
            return pdfjsLib.getDocument({ data: buffer }).promise;
          });
        })
        .then(function (pdf) {
          return pdf.getPage(1);
        })
        .then(function (page) {
          // Escala 2x: melhora bastante a precisão do OCR em relação ao
          // tamanho "nativo" (72dpi) do PDF.
          var viewport = page.getViewport({ scale: 2 });
          var canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          var canvasContext = canvas.getContext('2d');
          return page.render({ canvasContext: canvasContext, viewport: viewport }).promise.then(function () {
            return canvas;
          });
        })
        .catch(function (err) {
          throw new Error(
            'Não foi possível ler o PDF do comprovante' + (err && err.message ? ': ' + err.message : '.')
          );
        });
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
    constructor(ocrLoader, classifier, merchantCnpjDigits, merchantName, pdfPageRenderer) {
      this.ocrLoader = ocrLoader;
      this.classifier = classifier;
      this.merchantCnpjDigits = merchantCnpjDigits;
      this.merchantName = merchantName;
      this.pdfPageRenderer = pdfPageRenderer;
    }

    /**
     * Lê e valida um comprovante de transferência.
     *
     * file: File selecionado pelo usuário no <input type="file">
     *       (.png, .jpg/.jpeg ou .pdf)
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

      var kind = detectFileKind(file);
      if (kind === 'unsupported') {
        return Promise.reject(
          new Error('Formato não suportado. Envie um arquivo .png, .jpg/.jpeg ou .pdf.')
        );
      }

      var self = this;

      // PDF: primeiro rasteriza a 1ª página num <canvas>; imagem: usa o
      // próprio File. Em ambos os casos o que segue para o OCR é aceito
      // nativamente pelo Tesseract.js (File ou HTMLCanvasElement).
      var sourcePromise =
        kind === 'pdf' ? this.pdfPageRenderer.renderFirstPageToCanvas(file) : Promise.resolve(file);

      return sourcePromise
        .then(function (source) {
          return self.ocrLoader.load().then(function (Tesseract) {
            return Tesseract.recognize(source, 'por');
          });
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
    MERCHANT_NAME,
    new PdfPageRenderer(new PdfEngineLoader(PDFJS_CDN_URL, PDFJS_WORKER_CDN_URL))
  );

  global.ReceiptAI = {
    analyze: function (file, ctx) { return receiptAnalyzer.analyze(file, ctx); },
    SUPPORTED_EXTENSIONS: SUPPORTED_EXTENSIONS,
    TYPE_LABELS: TYPE_LABELS
  };
})(window);
