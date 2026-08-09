/* =============================================================
   js/google-ai-chatbot.js
   Cliente simples para conversar com modelos Gemini via API do Google.
   ============================================================= */

(function (global) {
  "use strict";

  const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

  function getTextFromCandidate(candidate) {
    if (!candidate || !candidate.content || !Array.isArray(candidate.content.parts)) return "";
    return candidate.content.parts
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
  }

  class GoogleAIChatbotClient {
    constructor() {
      this.history = [];
    }

    clear() {
      this.history = [];
    }

    async sendMessage(opts) {
      const apiKey = String((opts && opts.apiKey) || "").trim();
      const model = String((opts && opts.model) || "gemini-2.5-flash").trim();
      const message = String((opts && opts.message) || "").trim();
      const grounding = !!(opts && opts.grounding);

      if (!apiKey) throw new Error("Informe sua Google AI API Key.");
      if (!message) throw new Error("Digite uma mensagem para conversar com o agente.");

      const body = {
        systemInstruction: {
          parts: [
            {
              text:
                "Você é um assistente financeiro para usuários brasileiros. Seja objetivo, claro, seguro e prático. Não invente dados.",
            },
          ],
        },
        contents: this.history.concat([{ role: "user", parts: [{ text: message }] }]),
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
        },
      };

      if (grounding) body.tools = [{ google_search: {} }];

      const res = await fetch(`${API_BASE}${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      let data = {};
      try {
        data = await res.json();
      } catch (_err) {}

      if (!res.ok) {
        const msg = data && data.error && data.error.message ? data.error.message : "Falha ao consultar a API do Google AI.";
        throw new Error(msg);
      }

      const candidate = data && data.candidates && data.candidates[0];
      const responseText = getTextFromCandidate(candidate);
      if (!responseText) throw new Error("A IA não retornou texto nesta resposta.");

      this.history.push({ role: "user", parts: [{ text: message }] });
      this.history.push({ role: "model", parts: [{ text: responseText }] });

      return { text: responseText };
    }
  }

  global.GoogleAIChatbot = new GoogleAIChatbotClient();
})(window);
