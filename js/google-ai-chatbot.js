/* =============================================================
   js/google-ai-chatbot.js
   AgenteIA de despesas sem token, com contexto opcional via API pública do GitHub.
   ============================================================= */

(function (global) {
  "use strict";

  const GITHUB_API = "https://api.github.com";

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function pickCategory(message) {
    const rawText = String(message || "");
    const text = rawText.toLowerCase();
    const explicitQuoted =
      rawText.match(/categoria\s*(?:é|:|=|de)?\s*["“]([^"”]+)["”]/i) ||
      rawText.match(/para\s+a\s+categoria\s*["“]([^"”]+)["”]/i);
    if (explicitQuoted && explicitQuoted[1]) return explicitQuoted[1].trim().replace(/\s{2,}/g, " ");
    const explicitPlain =
      rawText.match(
        /categoria\s*(?:é|:|=|de)?\s*([a-zà-úç][a-zà-úç\s/-]{1,40}?)(?=\s*(?:,|\.|;|!|\?|$|e\s+com|com\s+a|com\s+os?|entre))/i
      ) ||
      rawText.match(/para\s+a\s+categoria\s*([a-zà-úç][a-zà-úç\s/-]{1,40}?)(?=\s*(?:,|\.|;|!|\?|$|e\s+com|com\s+a|com\s+os?|entre))/i);
    const explicit = explicitPlain;
    if (explicit && explicit[1]) return explicit[1].trim().replace(/\s{2,}/g, " ");
    if (/alimentaç|alimentacao/.test(text)) return "Alimentação";
    if (/mercado|supermercado|restaurante|comida|ifood/.test(text)) return "Alimentação";
    if (/uber|99|taxi|ônibus|metro|combust|gasolina|transporte/.test(text)) return "Transporte";
    if (/aluguel|condomínio|energia|água|internet|moradia/.test(text)) return "Moradia";
    if (/academia|médic|farmácia|saúde/.test(text)) return "Saúde";
    if (/netflix|cinema|lazer|viagem|jogo/.test(text)) return "Lazer";
    if (/curso|livro|github|software|assinatura|nuvem|dev/.test(text)) return "Trabalho";
    return "Outros";
  }

  function inferCount(message) {
    const match = String(message || "").match(/(\d{1,2})\s*(despesa|despesas|gasto|gastos)/i);
    return clamp(match ? Number(match[1]) : 3, 1, 10);
  }

  function inferBaseAmount(message) {
    const m = String(message || "").match(/(?:r\$\s*)?(\d{1,5}(?:[.,]\d{1,2})?)/i);
    const parsed = m ? Number(String(m[1]).replace(",", ".")) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return 45;
    return parsed;
  }

  function inferAmountRange(message) {
    const text = String(message || "");
    const range = text.match(
      /entre\s*(?:r\$\s*)?(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:e|a|até|-)\s*(?:r\$\s*)?(\d{1,5}(?:[.,]\d{1,2})?)/i
    );
    if (!range) return null;
    const a = Number(String(range[1]).replace(",", "."));
    const b = Number(String(range[2]).replace(",", "."));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  function inferDescription(message) {
    const text = String(message || "");
    const quoted = text.match(/descriç(?:ã|a)o\s*(?:é|:|=|de)?\s*["“]([^"”]+)["”]/i);
    if (quoted && quoted[1]) return quoted[1].trim();
    const plain = text.match(
      /descriç(?:ã|a)o\s*(?:é|:|=|de)?\s*([^,.!?;\n]+?)(?=\s+com\s+os?\s+valores|\s+entre\s+(?:r\$\s*)?\d|\s+de\s+(?:r\$\s*)?\d|$)/i
    );
    if (!plain || !plain[1]) return "";
    return plain[1].trim().replace(/\s{2,}/g, " ");
  }

  function amountForIndex(base, range, i, count) {
    if (!range) {
      const factor = 1 + ((i % 3) - 1) * 0.15;
      return Number((base * factor).toFixed(2));
    }
    if (count <= 1) return Number((((range.min + range.max) / 2)).toFixed(2));
    const ratio = i / (count - 1);
    return Number((range.min + ratio * (range.max - range.min)).toFixed(2));
  }

  function nextDate(offset) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  }

  function buildExpenses(message, githubSummary) {
    const count = inferCount(message);
    const base = inferBaseAmount(message);
    const range = inferAmountRange(message);
    const category = pickCategory(message);
    const requestedDescription = inferDescription(message);
    const expenses = [];

    for (let i = 0; i < count; i++) {
      expenses.push({
        amount: amountForIndex(base, range, i, count),
        date: nextDate(i),
        description: requestedDescription || `Despesa ${category.toLowerCase()} #${i + 1}`,
        category,
        transaction_number: githubSummary ? `GH-${githubSummary.publicEvents}-${i + 1}` : `AG-${Date.now()}-${i + 1}`,
      });
    }

    if (githubSummary && githubSummary.publicEvents > 0 && expenses.length) {
      expenses[0].description = `Ferramentas GitHub (${githubSummary.publicEvents} eventos públicos)`;
      expenses[0].category = "Trabalho";
    }

    return expenses;
  }

  async function loadGithubSummary(username) {
    const user = String(username || "").trim();
    if (!user) return null;

    const [profileRes, eventsRes] = await Promise.all([
      fetch(`${GITHUB_API}/users/${encodeURIComponent(user)}`),
      fetch(`${GITHUB_API}/users/${encodeURIComponent(user)}/events/public?per_page=10`),
    ]);

    if (!profileRes.ok) throw new Error("Usuário GitHub não encontrado.");
    const profile = await profileRes.json();
    let events = [];
    if (eventsRes.ok) {
      try {
        events = await eventsRes.json();
      } catch (_err) {}
    }

    return {
      login: profile.login,
      repos: Number(profile.public_repos || 0),
      followers: Number(profile.followers || 0),
      publicEvents: Array.isArray(events) ? events.length : 0,
    };
  }

  class GitHubExpenseAgentClient {
    constructor() {
      this.history = [];
    }

    clear() {
      this.history = [];
    }

    async sendMessage(opts) {
      const message = String((opts && opts.message) || "").trim();
      const githubUser = String((opts && opts.githubUser) || "").trim();
      if (!message) throw new Error("Digite uma mensagem para conversar com o agente.");

      let githubSummary = null;
      let githubLine = "";
      if (githubUser) {
        githubSummary = await loadGithubSummary(githubUser);
        githubLine = `Contexto GitHub: @${githubSummary.login} · ${githubSummary.repos} repositórios públicos · ${githubSummary.followers} seguidores · ${githubSummary.publicEvents} eventos recentes.\n\n`;
      }

      const expenses = buildExpenses(message, githubSummary);
      const intro = "Sugeri despesas com base no seu pedido para importar direto na tela de despesas.";
      const text = `${githubLine}${intro}\n\n\`\`\`json\n${JSON.stringify(expenses, null, 2)}\n\`\`\``;

      this.history.push({ role: "user", content: message });
      this.history.push({ role: "assistant", content: text });

      return { text };
    }
  }

  global.GitHubExpenseAgent = new GitHubExpenseAgentClient();
  global.GoogleAIChatbot = global.GitHubExpenseAgent;
})(window);
