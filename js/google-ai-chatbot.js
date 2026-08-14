/* =============================================================
   js/google-ai-chatbot.js
   SpaceHub - Chatbot de Financiamento (sem token), com contexto
   opcional via API pública do GitHub e API interna de metodologias
   da linguagem portuguesa.
   ============================================================= */

(function (global) {
  "use strict";

  const GITHUB_API = "https://api.github.com";

  class PortugueseLanguageMethodologyApi {
    constructor() {
      this.catalog = {
        verbos: ["Planeje", "Organize", "Priorize", "Monitore", "Ajuste", "Revise"],
        adjetivos: ["consciente", "estratégico", "equilibrado", "sustentável", "eficiente", "disciplinado"],
        proverbios: [
          "De grão em grão, a reserva cresce.",
          "Quem poupa hoje investe melhor amanhã.",
          "Devagar se vai ao equilíbrio financeiro.",
          "Mais vale um gasto planejado do que dois impulsivos.",
        ],
        oracoes_subordinadas: [
          "para que o fluxo de caixa permaneça saudável",
          "embora existam variações no orçamento mensal",
          "quando surgir uma despesa inesperada",
          "a fim de que suas metas financeiras sejam cumpridas",
        ],
      };
    }

    list(opts) {
      const requested = Array.isArray(opts && opts.tipos)
        ? opts.tipos
        : typeof (opts && opts.tipo) === "string"
          ? [opts.tipo]
          : [];
      const map = {
        verbos: "verbos",
        verbo: "verbos",
        adjetivos: "adjetivos",
        adjetivo: "adjetivos",
        proverbios: "proverbios",
        provérbios: "proverbios",
        provérbio: "proverbios",
        proverbio: "proverbios",
        oracoes_subordinadas: "oracoes_subordinadas",
        orações_subordinadas: "oracoes_subordinadas",
        "orações subordinadas": "oracoes_subordinadas",
        "oracoes subordinadas": "oracoes_subordinadas",
        oracao_subordinada: "oracoes_subordinadas",
        oração_subordinada: "oracoes_subordinadas",
      };

      const keys = requested.length
        ? requested
            .map((item) => map[String(item || "").trim().toLowerCase()])
            .filter(Boolean)
        : Object.keys(this.catalog);

      const uniqueKeys = Array.from(new Set(keys));
      const output = {};
      uniqueKeys.forEach((key) => {
        output[key] = this.catalog[key].slice();
      });
      return output;
    }

    pick(key, seed) {
      const list = this.catalog[key] || [];
      if (!list.length) return "";
      return list[Math.abs(seed) % list.length];
    }

    getTokens(seed) {
      return {
        verbo: this.pick("verbos", seed),
        adjetivo: this.pick("adjetivos", seed + 1),
        proverbio: this.pick("proverbios", seed + 2),
        oracao_subordinada: this.pick("oracoes_subordinadas", seed + 3),
      };
    }
  }

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

  function resolveMethodologyRequestTypes(message) {
    const text = String(message || "").toLowerCase();
    if (!text.includes("api")) return null;

    const types = [];
    if (/verbos?/.test(text)) types.push("verbos");
    if (/adjetivos?/.test(text)) types.push("adjetivos");
    if (/(prov[eé]rbios?|proverbios?)/.test(text)) types.push("proverbios");
    if (/(ora[cç][aã]o(?:es)?\s+subordinadas?|ora[cç][oõ]es\s+subordinadas?)/.test(text)) {
      types.push("oracoes_subordinadas");
    }
    if (types.length) return Array.from(new Set(types));
    if (/linguagem portuguesa|metodologias?/.test(text)) return [];
    return null;
  }

  function buildExpenses(message, githubSummary, languageApi) {
    const count = inferCount(message);
    const base = inferBaseAmount(message);
    const range = inferAmountRange(message);
    const category = pickCategory(message);
    const requestedDescription = inferDescription(message);
    const expenses = [];

    for (let i = 0; i < count; i++) {
      const languageTokens = languageApi.getTokens(i + count + category.length);
      const generatedDescription = `${languageTokens.verbo} gastos de ${category.toLowerCase()} de forma ${languageTokens.adjetivo}, ${languageTokens.oracao_subordinada}.`;
      expenses.push({
        amount: amountForIndex(base, range, i, count),
        date: nextDate(i),
        description: requestedDescription || generatedDescription,
        category,
        transaction_number: githubSummary ? `GH-${githubSummary.publicEvents}-${i + 1}` : `AG-${Date.now()}-${i + 1}`,
        language_metadata: languageTokens,
      });
    }

    if (githubSummary && githubSummary.publicEvents > 0 && expenses.length) {
      expenses[0].description = `Ferramentas GitHub (${githubSummary.publicEvents} eventos públicos)`;
      expenses[0].category = "Trabalho";
    }

    return expenses;
  }

  class ChatbotVirtualMachine {
    constructor(languageApi) {
      this.languageApi = languageApi;
    }

    async run(program, context) {
      const state = {
        message: "",
        githubUser: "",
        methodologyTypes: null,
        githubSummary: null,
        githubLine: "",
        expenses: [],
        text: "",
        vm_trace: [],
        ...(context || {}),
      };
      const instructions = Array.isArray(program) ? program : [];
      for (const instruction of instructions) {
        await this._exec(instruction, state);
      }
      return state;
    }

    async _exec(instruction, state) {
      const op = String((instruction && instruction.op) || "").trim().toUpperCase();
      state.vm_trace.push(op);
      if (op === "LIST_LANGUAGE_API") {
        const payload = this.languageApi.list({ tipos: state.methodologyTypes });
        state.text = `SpaceHub API de metodologias da linguagem portuguesa:\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
        return;
      }
      if (op === "FETCH_GITHUB_SUMMARY") {
        if (!state.githubUser) return;
        try {
          state.githubSummary = await loadGithubSummary(state.githubUser);
          state.githubLine =
            `Contexto GitHub: @${state.githubSummary.login} · ${state.githubSummary.repos} repositórios públicos · ` +
            `${state.githubSummary.followers} seguidores · ${state.githubSummary.publicEvents} eventos recentes.\n\n`;
        } catch (_err) {
          state.githubSummary = null;
          state.githubLine = "Não consegui carregar o contexto do GitHub agora, então gerei as despesas sem esse complemento.\n\n";
        }
        return;
      }
      if (op === "GENERATE_EXPENSES") {
        state.expenses = buildExpenses(state.message, state.githubSummary, this.languageApi);
        return;
      }
      if (op === "FORMAT_EXPENSES_RESPONSE") {
        const intro = "Sugeri despesas com base no seu pedido para importar direto na tela de despesas.";
        state.text = `${state.githubLine}${intro}\n\n\`\`\`json\n${JSON.stringify(state.expenses, null, 2)}\n\`\`\``;
      }
    }
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

  class GitHubCopilotExpenseAgentClient {
    constructor() {
      this.history = [];
      this.languageApi = new PortugueseLanguageMethodologyApi();
      this.vm = new ChatbotVirtualMachine(this.languageApi);
    }

    clear() {
      this.history = [];
    }

    async sendMessage(opts) {
      const message = String((opts && opts.message) || "").trim();
      const githubUser = String((opts && opts.githubUser) || "").trim();
      if (!message) throw new Error("Digite uma mensagem para conversar com o agente.");

      const methodologyTypes = resolveMethodologyRequestTypes(message);
      if (methodologyTypes !== null) {
        const vmResult = await this.vm.run([{ op: "LIST_LANGUAGE_API" }], { message, methodologyTypes });
        const text = vmResult.text;
        this.history.push({ role: "user", content: message });
        this.history.push({ role: "assistant", content: text });
        return { text };
      }

      const program = [
        ...(githubUser ? [{ op: "FETCH_GITHUB_SUMMARY" }] : []),
        { op: "GENERATE_EXPENSES" },
        { op: "FORMAT_EXPENSES_RESPONSE" },
      ];
      const vmResult = await this.vm.run(program, { message, githubUser });
      const text = vmResult.text;

      this.history.push({ role: "user", content: message });
      this.history.push({ role: "assistant", content: text });

      return { text };
    }
  }

  global.GitHubCopilotAgent = new GitHubCopilotExpenseAgentClient();
  global.GitHubExpenseAgent = global.GitHubCopilotAgent;
  global.SpaceHubLanguageApi = global.GitHubCopilotAgent.languageApi;
  global.GoogleAIChatbot = global.GitHubCopilotAgent;
})(window);
