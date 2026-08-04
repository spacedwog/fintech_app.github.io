/* =============================================================
   js/pix.js
   Gerador do payload Pix "Copia e Cola" (BR Code / EMV®QRCPS),
   o mesmo formato que qualquer app de banco lê para pagar via Pix.

   100% client-side: o valor e a chave Pix ficam embutidos direto
   no código (QR estático com valor fixo). Isso é um cobrança Pix
   REAL — quem escanear e pagar transfere dinheiro de verdade para
   a chave configurada. O que este arquivo NÃO faz é confirmar o
   recebimento automaticamente: isso só é possível com um backend
   integrado a um provedor de pagamentos (PSP) via webhook, que
   este projeto (site estático) não tem.
   ============================================================= */

(function (global) {
  'use strict';

  function pad2(n) {
    var s = String(n);
    return s.length === 1 ? '0' + s : s;
  }

  // Campo EMV: ID (2 dígitos) + TAMANHO (2 dígitos) + VALOR
  function emv(id, value) {
    value = String(value);
    return id + pad2(value.length) + value;
  }

  // CRC-16/CCITT-FALSE (polinômio 0x1021, inicial 0xFFFF) — exigido
  // pelo Banco Central no campo final (ID 63) do BR Code.
  function crc16ccitt(str) {
    var crc = 0xffff;
    for (var i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (var b = 0; b < 8; b++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    var hex = crc.toString(16).toUpperCase();
    while (hex.length < 4) hex = '0' + hex;
    return hex;
  }

  function sanitizeTxid(txid) {
    var clean = String(txid || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return (clean || '***').slice(0, 25);
  }

  /**
   * Monta o payload Pix (BR Code) completo, pronto para virar QR Code
   * ou ser copiado como "Pix Copia e Cola".
   *
   * opts:
   *   key         (obrigatório) chave Pix (CPF/CNPJ/e-mail/telefone/aleatória), sem formatação
   *   name        nome do recebedor (máx. 25 caracteres)
   *   city        cidade do recebedor (máx. 15 caracteres)
   *   amount      valor fixo da cobrança (number), opcional
   *   description texto livre (máx. 40 caracteres), opcional
   *   txid        identificador da transação (A-Z0-9, máx. 25), opcional
   */
  function buildPayload(opts) {
    opts = opts || {};
    if (!opts.key) throw new Error('Chave Pix obrigatória');

    var name = String(opts.name || '').toUpperCase().slice(0, 25);
    var city = String(opts.city || '').toUpperCase().slice(0, 15);
    var txid = sanitizeTxid(opts.txid);

    var merchantAccountInfo = emv('00', 'br.gov.bcb.pix') + emv('01', opts.key);
    if (opts.description) {
      merchantAccountInfo += emv('02', String(opts.description).slice(0, 40));
    }

    var payload =
      emv('00', '01') + // Payload Format Indicator
      emv('01', '11') + // Point of Initiation Method: 11 = QR estático (reutilizável)
      emv('26', merchantAccountInfo) + // Merchant Account Info (Pix)
      emv('52', '0000') + // Merchant Category Code
      emv('53', '986') + // Transaction Currency: 986 = BRL
      (opts.amount ? emv('54', Number(opts.amount).toFixed(2)) : '') +
      emv('58', 'BR') + // Country Code
      emv('59', name || 'RECEBEDOR') + // Merchant Name
      emv('60', city || 'BRASIL') + // Merchant City
      emv('62', emv('05', txid)); // Additional Data Field (txid)

    payload += '6304'; // ID + tamanho fixo do CRC, antes de calcular
    return payload + crc16ccitt(payload);
  }

  // Gera um txid curto e único (só A-Z0-9), para conseguir correlacionar
  // o pagamento com o pedido no histórico local.
  function generateTxid(prefix) {
    var ts = Date.now().toString(36).toUpperCase();
    var rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return sanitizeTxid(String(prefix || 'FIN') + ts + rand);
  }

  global.Pix = {
    buildPayload: buildPayload,
    generateTxid: generateTxid,
  };
})(window);
