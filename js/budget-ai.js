/* =============================================================
   js/budget-ai.js
   "IA" de leitura de orçamento via upload.

   Roda 100% no navegador: usa SheetJS (biblioteca xlsx, carregada
   sob demanda via CDN) para ler a planilha de orçamento que o
   usuário enviar (.xlsx / .xls / .csv) e aplica regras heurísticas
   para reconhecer categorias, meses e valores Previsto/Realizado,
   apontando quais categorias estouraram o orçamento — sem depender
   de um arquivo fixo salvo no repositório nem de nenhum servidor.

   Suporta dois formatos de planilha:
     1) "Longo": uma linha por categoria (+ mês opcional), com
        colunas Categoria / Mês / Previsto / Realizado — nomes de
        cabeçalho flexíveis, ver HEADER_SYNONYMS.
     2) "Largo" (mesmo layout usado pelo orcamento_agent): uma
        coluna Categoria + um par de colunas Previsto/Realizado por
        mês, com o nome do mês na linha 1 (célula mesclada) e
        "Previsto"/"Realizado" na linha 2.

   Mesma transparência do restante do projeto: isto NÃO é um modelo
   de linguagem hospedado em servidor — é leitura de planilha +
   heurística de cabeçalho rodando no cliente. Serve para dar uma
   leitura rápida de qualquer orçamento que o usuário suba, mas não
   substitui a conferência manual quando o formato foge do comum.
   ============================================================= */

(function (global) {
  'use strict';

  var XLSX_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  var HEADER_SYNONYMS = {
    categoria: ['categoria', 'category', 'item', 'descricao'],
    mes: ['mes', 'month', 'periodo', 'referencia'],
    previsto: ['previsto', 'orcado', 'budget', 'planejado', 'planned'],
    realizado: ['realizado', 'gasto', 'actual', 'spent', 'pago'],
  };

  function stripAccents(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
  }

  function normalizeHeader(s) {
    return stripAccents(s).toLowerCase().trim();
  }

  function toNumber(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var s = String(v).trim();
    // aceita tanto "1.234,56" (formato BR) quanto "1234.56" (formato US)
    if (/,\d{1,2}$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
    s = s.replace(/[^\d.\-]/g, '');
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function loadXLSX() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    if (loadXLSX._pending) return loadXLSX._pending;

    loadXLSX._pending = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = XLSX_CDN_URL;
      script.async = true;
      script.onload = function () {
        if (global.XLSX) resolve(global.XLSX);
        else reject(new Error('Leitor de planilhas carregado, mas indisponível.'));
      };
      script.onerror = function () {
        reject(new Error('Não foi possível carregar o leitor de planilhas (verifique sua conexão).'));
      };
      document.head.appendChild(script);
    });

    return loadXLSX._pending;
  }

  function readWorkbook(file, XLSX) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = new Uint8Array(e.target.result);
          var wb = XLSX.read(data, { type: 'array', cellDates: false });
          resolve(wb);
        } catch (err) {
          reject(new Error('Não foi possível ler o arquivo. Confira se é uma planilha válida (.xlsx, .xls ou .csv).'));
        }
      };
      reader.onerror = function () {
        reject(new Error('Falha ao abrir o arquivo enviado.'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // Escolhe a melhor aba: prioriza uma chamada "Orçamento"/"Budget",
  // senão cai na primeira aba da planilha.
  function pickSheet(wb) {
    var names = wb.SheetNames || [];
    var preferred = names.find(function (n) {
      var norm = normalizeHeader(n);
      return norm.indexOf('orcamento') !== -1 || norm.indexOf('budget') !== -1;
    });
    return preferred || names[0];
  }

  // Formato "longo": procura, nas primeiras linhas, um cabeçalho com
  // colunas reconhecíveis de Categoria/Previsto (Mês e Realizado são
  // opcionais).
  function tryLongFormat(rows) {
    for (var r = 0; r < Math.min(rows.length, 5); r++) {
      var header = rows[r] || [];
      var map = {};
      for (var c = 0; c < header.length; c++) {
        var norm = normalizeHeader(header[c]);
        Object.keys(HEADER_SYNONYMS).forEach(function (key) {
          if (map[key] == null && HEADER_SYNONYMS[key].indexOf(norm) !== -1) map[key] = c;
        });
      }
      if (map.categoria != null && map.previsto != null) {
        var entries = [];
        for (var i = r + 1; i < rows.length; i++) {
          var row = rows[i] || [];
          var categoria = row[map.categoria];
          if (categoria == null || String(categoria).trim() === '') continue;
          var previsto = toNumber(row[map.previsto]) || 0;
          var realizado = map.realizado != null ? (toNumber(row[map.realizado]) || 0) : 0;
          var mes = map.mes != null ? row[map.mes] : null;
          entries.push({
            categoria: String(categoria).trim(),
            mes: mes ? String(mes).trim() : null,
            previsto: previsto,
            realizado: realizado,
          });
        }
        if (entries.length) return entries;
      }
    }
    return null;
  }

  // Formato "largo" (mesmo layout do orcamento_agent): coluna 0 =
  // Categoria, e pares de colunas Previsto/Realizado por mês, com o
  // nome do mês na linha 1 e "Previsto"/"Realizado" na linha 2.
  function tryWideFormat(rows) {
    if (rows.length < 3) return null;
    var monthRow = null, subRow = null, headerIdx = -1;
    for (var r = 0; r < Math.min(rows.length - 1, 5); r++) {
      var sub = (rows[r + 1] || []).map(normalizeHeader);
      var hits = sub.filter(function (v) { return v === 'previsto' || v === 'realizado'; }).length;
      if (hits >= 2) {
        monthRow = rows[r];
        subRow = rows[r + 1];
        headerIdx = r + 1;
        break;
      }
    }
    if (!monthRow) return null;

    // célula mesclada só grava valor na primeira coluna do par — propaga
    // o nome do mês para a coluna seguinte (Realizado).
    var months = [];
    var lastMonth = null;
    for (var c = 0; c < monthRow.length; c++) {
      var v = monthRow[c];
      if (v != null && String(v).trim() !== '') lastMonth = String(v).trim();
      months[c] = lastMonth;
    }

    var pairs = [];
    for (var c2 = 0; c2 < subRow.length; c2++) {
      var label = normalizeHeader(subRow[c2]);
      if (label === 'previsto') {
        var realizadoCol = normalizeHeader(subRow[c2 + 1]) === 'realizado' ? c2 + 1 : null;
        pairs.push({ mes: months[c2], previstoCol: c2, realizadoCol: realizadoCol });
      }
    }
    if (!pairs.length) return null;

    var entries = [];
    for (var i = headerIdx + 1; i < rows.length; i++) {
      var row = rows[i] || [];
      var categoria = row[0];
      if (categoria == null || String(categoria).trim() === '') continue;
      pairs.forEach(function (p) {
        var previsto = toNumber(row[p.previstoCol]);
        var realizado = p.realizadoCol != null ? toNumber(row[p.realizadoCol]) : null;
        if (previsto == null && realizado == null) return;
        entries.push({
          categoria: String(categoria).trim(),
          mes: p.mes,
          previsto: previsto || 0,
          realizado: realizado || 0,
        });
      });
    }
    return entries.length ? entries : null;
  }

  function buildResult(entries) {
    var rows = entries.map(function (e) {
      var saldo = e.previsto - e.realizado;
      var status = saldo < 0 ? 'ESTOURADO' : 'DENTRO DO ORÇAMENTO';
      return {
        categoria: e.categoria,
        mes: e.mes,
        previsto: e.previsto,
        realizado: e.realizado,
        saldo: saldo,
        status: status,
      };
    });

    var totalPrevisto = rows.reduce(function (s, r) { return s + r.previsto; }, 0);
    var totalRealizado = rows.reduce(function (s, r) { return s + r.realizado; }, 0);
    var alerts = rows.filter(function (r) { return r.status === 'ESTOURADO'; });

    return {
      ok: true,
      rows: rows,
      totalPrevisto: totalPrevisto,
      totalRealizado: totalRealizado,
      saldoTotal: totalPrevisto - totalRealizado,
      alerts: alerts,
      overBudget: alerts.length > 0,
    };
  }

  /**
   * Lê e analisa uma planilha de orçamento enviada pelo usuário.
   *
   * file: File (.xlsx/.xls/.csv) selecionado em <input type="file">
   *
   * Resolve com:
   *   {
   *     ok: true,
   *     sheetName,        aba usada na leitura
   *     rows: [{ categoria, mes, previsto, realizado, saldo, status }],
   *     totalPrevisto, totalRealizado, saldoTotal,
   *     alerts: [linhas estouradas],
   *     overBudget: boolean
   *   }
   * ou rejeita com um Error de mensagem amigável quando não
   * conseguir reconhecer o formato do arquivo.
   */
  function analyze(file) {
    if (!file) return Promise.reject(new Error('Nenhum arquivo selecionado.'));

    return loadXLSX()
      .then(function (XLSX) {
        return readWorkbook(file, XLSX).then(function (wb) { return { XLSX: XLSX, wb: wb }; });
      })
      .then(function (ctx) {
        var wb = ctx.wb;
        var sheetName = pickSheet(wb);
        if (!sheetName) throw new Error('A planilha enviada não tem nenhuma aba com dados.');

        var sheet = wb.Sheets[sheetName];
        var rows = ctx.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

        var entries = tryWideFormat(rows) || tryLongFormat(rows);
        if (!entries) {
          throw new Error(
            'Não reconheci o formato do orçamento na aba "' + sheetName + '". Use uma coluna "Categoria" e ' +
            'colunas "Previsto"/"Realizado" (por mês, lado a lado, ou uma linha por categoria+mês).'
          );
        }

        var result = buildResult(entries);
        result.sheetName = sheetName;
        return result;
      });
  }

  global.BudgetAI = { analyze: analyze };
})(window);
