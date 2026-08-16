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

   Reescrito em POO: PixPayloadBuilder concentra a lógica EMV/CRC16.
   window.Pix continua existindo (mesma interface usada por
   js/dashboard.js: Pix.buildPayload/Pix.generateTxid), agora
   delegando para uma instância única da classe.
   ============================================================= */

(function (global) {
  'use strict';

  class PixPayloadBuilder {
    _secureRandomBase36(size) {
      var cryptoApi = (typeof globalThis !== 'undefined' && globalThis.crypto)
        || (global && global.crypto)
        || null;
      if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
        return Date.now().toString(36).slice(-size).toUpperCase().padEnd(size, '0');
      }
      var bytes = new Uint8Array(size);
      cryptoApi.getRandomValues(bytes);
      var out = '';
      for (var i = 0; i < bytes.length; i++) {
        out += (bytes[i] % 36).toString(36).toUpperCase();
      }
      return out;
    }

    _pad2(n) {
      var s = String(n);
      return s.length === 1 ? '0' + s : s;
    }

    // Campo EMV: ID (2 dígitos) + TAMANHO (2 dígitos) + VALOR
    _emv(id, value) {
      value = String(value);
      return id + this._pad2(value.length) + value;
    }

    // CRC-16/CCITT-FALSE (polinômio 0x1021, inicial 0xFFFF) — exigido
    // pelo Banco Central no campo final (ID 63) do BR Code.
    _crc16ccitt(str) {
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

    _sanitizeTxid(txid) {
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
    buildPayload(opts) {
      opts = opts || {};
      if (!opts.key) throw new Error('Chave Pix obrigatória');

      var name = String(opts.name || '').toUpperCase().slice(0, 25);
      var city = String(opts.city || '').toUpperCase().slice(0, 15);
      var txid = this._sanitizeTxid(opts.txid);

      var merchantAccountInfo = this._emv('00', 'br.gov.bcb.pix') + this._emv('01', opts.key);
      if (opts.description) {
        merchantAccountInfo += this._emv('02', String(opts.description).slice(0, 40));
      }

      var payload =
        this._emv('00', '01') + // Payload Format Indicator
        this._emv('01', '11') + // Point of Initiation Method: 11 = QR estático (reutilizável)
        this._emv('26', merchantAccountInfo) + // Merchant Account Info (Pix)
        this._emv('52', '0000') + // Merchant Category Code
        this._emv('53', '986') + // Transaction Currency: 986 = BRL
        (opts.amount ? this._emv('54', Number(opts.amount).toFixed(2)) : '') +
        this._emv('58', 'BR') + // Country Code
        this._emv('59', name || 'RECEBEDOR') + // Merchant Name
        this._emv('60', city || 'BRASIL') + // Merchant City
        this._emv('62', this._emv('05', txid)); // Additional Data Field (txid)

      payload += '6304'; // ID + tamanho fixo do CRC, antes de calcular
      return payload + this._crc16ccitt(payload);
    }

    // Gera um txid curto e único (só A-Z0-9), para conseguir correlacionar
    // o pagamento com o pedido no histórico local.
    generateTxid(prefix) {
      var ts = Date.now().toString(36).toUpperCase();
      var rand = this._secureRandomBase36(6);
      return this._sanitizeTxid(String(prefix || 'FIN') + ts + rand);
    }
  }

  var pixPayloadBuilder = new PixPayloadBuilder();

  global.Pix = {
    buildPayload: function (opts) { return pixPayloadBuilder.buildPayload(opts); },
    generateTxid: function (prefix) { return pixPayloadBuilder.generateTxid(prefix); },
  };
})(window);
