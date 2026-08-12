/* =============================================================
   js/google-ai-chatbot.js
   Cliente simples para conversar com modelos ChatGPT via API da OpenAI.
   ============================================================= */

(function (global) {
  "use strict";

  const API_URL = "https://api.openai.com/v1/chat/completions";

  function getTextFromChoice(choice) {
    if (!choice || !choice.message) return "";
    const content = choice.message.content;
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
  }

  class ChatGPTChatbotClient {
    constructor() {
      this.history = [];
    }

    clear() {
      this.history = [];
    }

    async sendMessage(opts) {
      const token = String((opts && opts.token) || "").trim();
      const model = String((opts && opts.model) || "gpt-4.1-mini").trim();
      const message = String((opts && opts.message) || "").trim();

      if (!token) throw new Error("Informe seu token da OpenAI (ChatGPT).");
      if (!message) throw new Error("Digite uma mensagem para conversar com o agente.");

      const body = {
        model,
        temperature: 0.3,
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content:
              "Você é um assistente financeiro para usuários brasileiros focado em gerar despesas para o app. Seja objetivo, claro, seguro e prático. Não invente dados. Quando o usuário pedir para criar/lançar despesas, sempre inclua no fim da resposta um bloco ```json``` contendo um array de objetos de despesas com os campos: amount (número), date (YYYY-MM-DD), description (texto), category (texto), transaction_number (texto, opcional).",
          },
        ].concat(this.history, [{ role: "user", content: message }]),
      };

      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: ["Bearer", token].join(" "),
        },
        body: JSON.stringify(body),
      });

      let data = {};
      try {
        data = await res.json();
      } catch (_err) {}

      if (!res.ok) {
        const msg = data && data.error && data.error.message ? data.error.message : "Falha ao consultar a API da OpenAI.";
        throw new Error(msg);
      }

      const choice = data && data.choices && data.choices[0];
      const responseText = getTextFromChoice(choice);
      if (!responseText) throw new Error("A IA não retornou texto nesta resposta.");

      this.history.push({ role: "user", content: message });
      this.history.push({ role: "assistant", content: responseText });

      return { text: responseText };
    }
  }

  global.ChatGPTChatbot = new ChatGPTChatbotClient();
  global.GoogleAIChatbot = global.ChatGPTChatbot;
})(window);
