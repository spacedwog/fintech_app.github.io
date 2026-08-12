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
    const text = String(message || "").toLowerCase();
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

  function nextDate(offset) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  }

  function buildExpenses(message, githubSummary) {
    const count = inferCount(message);
    const base = inferBaseAmount(message);
    const category = pickCategory(message);
    const expenses = [];

    for (let i = 0; i < count; i++) {
      const factor = 1 + ((i % 3) - 1) * 0.15;
      expenses.push({
        amount: Number((base * factor).toFixed(2)),
        date: nextDate(i),
        description: `Despesa ${category.toLowerCase()} #${i + 1}`,
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
