// ===============================
// js/db.js
// "Banco de dados" 100% client-side, sem servidor.
//
// Fonte primária: um documento XML, serializado e guardado no
// localStorage do navegador (não existe servidor/arquivo real para
// gravar num app estático, então o "arquivo" XML mora dentro do
// localStorage, mas todo o esquema/gravação/leitura é feito via
// DOMParser/XMLSerializer, como um banco XML de verdade).
//
// Fallback: se o navegador não suportar XML (DOMParser/XMLSerializer)
// ou o XML salvo estiver corrompido, o app cai automaticamente para o
// formato antigo (JSON puro em localStorage). Esse fallback em JSON
// também é mantido atualizado a cada gravação, como cópia de segurança
// — se o XML falhar a qualquer momento, nenhum dado é perdido.
//
// Arquivos em database/ (db.xml e db.json): são o banco "de fábrica",
// versionado junto com o código, usado só para inicializar o app na
// PRIMEIRA visita (quando ainda não há nada salvo no localStorage nem
// nenhum arquivo local conectado). Como o site é 100% estático (GitHub
// Pages, sem backend), o navegador não tem como gravar de volta nesses
// arquivos remotos.
//
// Arquivo local conectado (js/file-store.js): quando o usuário conecta um
// arquivo .xml no próprio computador (botão "Banco de Dados" no painel),
// esse arquivo passa a ser a fonte de leitura/gravação PRINCIPAL — tem
// prioridade sobre o localStorage. O localStorage continua sendo mantido
// como cópia de segurança/fallback em qualquer um dos casos.
//
// Ordem de prioridade em loadDb(): arquivo local conectado > XML em
// localStorage > JSON em localStorage > banco de fábrica (database/) >
// schema vazio.
// ===============================

const DB_XML_KEY = "fintech_saas_db_xml_v1"; // banco "oficial" (XML) em localStorage
const DB_JSON_KEY = "fintech_saas_db_v1"; // fallback / cópia de segurança (JSON) em localStorage

const DB_SEED_XML_URL = "database/db.xml"; // banco de fábrica (XML), só para o 1º carregamento
const DB_SEED_JSON_URL = "database/db.json"; // banco de fábrica (JSON), fallback do fallback

const DEFAULT_CATEGORIES = ["Alimentação", "Transporte", "Moradia", "Lazer", "Saúde", "Outros"];

// Feature-detection: alguns ambientes muito antigos não têm DOMParser/XMLSerializer.
let _xmlAvailable = typeof window !== "undefined" && !!window.DOMParser && !!window.XMLSerializer;

function _emptySchema() {
  return {
    tenants: [], // { id, name, plan, created_at }
    users: [], // { id, tenant_id, name, email, password_hash, role, created_at }
    categories: [], // { id, tenant_id, name }
    expenses: [], // { id, tenant_id, user_id, category_id, amount, date, description, created_at, is_extra, extra_charge }
    budgets: [], // { id, tenant_id, user_id, limit_value, month }
    _seq: { tenants: 0, users: 0, categories: 0, expenses: 0, budgets: 0 },
  };
}

// ---------- Definição das coleções / campos (usado na conversão XML) ----------

const XML_SCHEMA = {
  tenant: { attrs: ["id", "name", "plan", "created_at"], numeric: ["id"] },
  user: {
    attrs: ["id", "tenant_id", "name", "email", "password_hash", "role", "created_at"],
    numeric: ["id", "tenant_id"],
  },
  category: { attrs: ["id", "tenant_id", "name"], numeric: ["id", "tenant_id"] },
  expense: {
    attrs: [
      "id", "tenant_id", "user_id", "category_id", "amount", "date",
      "description", "created_at", "is_extra", "extra_charge",
    ],
    numeric: ["id", "tenant_id", "user_id", "category_id", "amount", "extra_charge"],
    boolean: ["is_extra"],
  },
  budget: { attrs: ["id", "tenant_id", "user_id", "limit_value", "month"], numeric: ["id", "tenant_id", "user_id", "limit_value"] },
};

const XML_COLLECTIONS = [
  { key: "tenants", tag: "tenant", wrapper: "tenants" },
  { key: "users", tag: "user", wrapper: "users" },
  { key: "categories", tag: "category", wrapper: "categories" },
  { key: "expenses", tag: "expense", wrapper: "expenses" },
  { key: "budgets", tag: "budget", wrapper: "budgets" },
];

function _escapeXmlAttr(value) {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------- objeto -> XML ----------

function dbToXmlString(db) {
  const seq = db._seq || {};
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<database>\n';

  xml +=
    "  <seq" +
    ` tenants="${seq.tenants || 0}"` +
    ` users="${seq.users || 0}"` +
    ` categories="${seq.categories || 0}"` +
    ` expenses="${seq.expenses || 0}"` +
    ` budgets="${seq.budgets || 0}"` +
    " />\n";

  XML_COLLECTIONS.forEach(({ key, tag, wrapper }) => {
    const fieldDef = XML_SCHEMA[tag];
    const items = db[key] || [];
    xml += `  <${wrapper}>\n`;
    items.forEach((item) => {
      const attrsStr = fieldDef.attrs.map((field) => `${field}="${_escapeXmlAttr(item[field])}"`).join(" ");
      xml += `    <${tag} ${attrsStr} />\n`;
    });
    xml += `  </${wrapper}>\n`;
  });

  xml += "</database>";
  return xml;
}

// ---------- XML -> objeto ----------

function xmlStringToDb(xmlStr) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlStr, "application/xml");
  const parseError = doc.getElementsByTagName("parsererror")[0];
  if (parseError) throw new Error("XML do banco inválido: " + parseError.textContent);

  const db = _emptySchema();

  const seqEl = doc.getElementsByTagName("seq")[0];
  if (seqEl) {
    Object.keys(db._seq).forEach((k) => {
      const v = seqEl.getAttribute(k);
      db._seq[k] = v !== null ? parseInt(v, 10) || 0 : 0;
    });
  }

  XML_COLLECTIONS.forEach(({ key, tag }) => {
    const fieldDef = XML_SCHEMA[tag];
    const nodes = doc.getElementsByTagName(tag);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const item = {};
      fieldDef.attrs.forEach((field) => {
        const raw = node.getAttribute(field);
        const val = raw === null ? "" : raw;
        if (fieldDef.numeric && fieldDef.numeric.includes(field)) {
          item[field] = val === "" ? null : Number(val);
        } else if (fieldDef.boolean && fieldDef.boolean.includes(field)) {
          item[field] = val === "true";
        } else {
          item[field] = val;
        }
      });
      db[key].push(item);
    }
  });

  return db;
}

// ---------- Fallback em JSON (localStorage) ----------

function _readJsonFallback() {
  const raw = localStorage.getItem(DB_JSON_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const base = _emptySchema();
    return { ...base, ...parsed, _seq: { ...base._seq, ...(parsed._seq || {}) } };
  } catch (e) {
    return null;
  }
}

function _writeJsonFallback(db) {
  try {
    localStorage.setItem(DB_JSON_KEY, JSON.stringify(db));
  } catch (e) {
    console.warn("Fintech SaaS: não foi possível gravar o fallback em localStorage (JSON).", e);
  }
}

// ---------- Banco de fábrica (database/db.xml e database/db.json) ----------

async function _fetchSeedDb() {
  // Só é chamado quando não há NADA salvo no localStorage ainda (1ª visita
  // deste navegador). Tenta o seed em XML primeiro, depois em JSON; se os
  // dois falharem (ex.: abrindo o index.html direto via file://, onde
  // fetch() de arquivos locais costuma ser bloqueado por CORS), segue sem
  // erro e o app parte de um schema vazio, como sempre fez.
  if (typeof fetch !== "function") return null;

  if (_xmlAvailable) {
    try {
      const res = await fetch(DB_SEED_XML_URL, { cache: "no-store" });
      if (res.ok) {
        const text = await res.text();
        return xmlStringToDb(text);
      }
    } catch (e) {
      console.warn("Fintech SaaS: não foi possível carregar o banco de fábrica em XML (database/db.xml).", e);
    }
  }

  try {
    const res = await fetch(DB_SEED_JSON_URL, { cache: "no-store" });
    if (res.ok) {
      const parsed = await res.json();
      const base = _emptySchema();
      return { ...base, ...parsed, _seq: { ...base._seq, ...(parsed._seq || {}) } };
    }
  } catch (e) {
    console.warn("Fintech SaaS: não foi possível carregar o banco de fábrica em JSON (database/db.json).", e);
  }

  return null;
}

// ---------- API pública (mesma interface de antes, agora assíncrona) ----------

function _fileStoreReady() {
  return typeof FileStore !== "undefined" && FileStore.isSupported();
}

async function loadDb() {
  // 0) Prioridade máxima: arquivo local conectado (leitura/gravação real
  //    em disco). Tenta reconectar em silêncio a um arquivo já autorizado
  //    antes; se conseguir, o conteúdo desse arquivo É o banco de dados.
  if (_fileStoreReady()) {
    try {
      const handle = await FileStore.tryReconnect();
      if (handle) {
        const text = await FileStore.readText();
        if (text && text.trim()) {
          const db = xmlStringToDb(text);
          _writeJsonFallback(db); // mantém o fallback em localStorage atualizado
          if (_xmlAvailable) localStorage.setItem(DB_XML_KEY, text);
          return db;
        }
      }
    } catch (e) {
      console.warn("Fintech SaaS: não foi possível ler o arquivo local conectado; usando localStorage.", e);
    }
  }

  // 1) Fonte primária (sem arquivo conectado): banco XML em localStorage.
  if (_xmlAvailable) {
    const rawXml = localStorage.getItem(DB_XML_KEY);
    if (rawXml) {
      try {
        return xmlStringToDb(rawXml);
      } catch (e) {
        console.warn("Fintech SaaS: XML do banco corrompido, usando fallback em localStorage (JSON).", e);
        _xmlAvailable = false;
      }
    }
  }

  // 2) Fallback: JSON em localStorage (XML indisponível/corrompido, mas já
  //    existiam dados salvos por aqui). Migra de volta para XML se possível.
  const legacy = _readJsonFallback();
  if (legacy) {
    if (_xmlAvailable) await saveDb(legacy);
    return legacy;
  }

  // 3) Nada em localStorage ainda: primeira visita. Tenta partir do banco
  //    de fábrica versionado em database/db.xml (ou database/db.json).
  const seeded = await _fetchSeedDb();
  if (seeded) {
    await saveDb(seeded);
    return seeded;
  }

  // 4) Sem localStorage e sem seed acessível: schema vazio, do zero.
  const fresh = _emptySchema();
  await saveDb(fresh);
  return fresh;
}

async function saveDb(db) {
  // Sempre atualiza a cópia de segurança em JSON, mesmo quando o XML/arquivo
  // funcionam — assim nunca há perda de dados se algum dos dois falhar.
  _writeJsonFallback(db);

  let xmlText = null;
  if (_xmlAvailable) {
    try {
      xmlText = dbToXmlString(db);
      localStorage.setItem(DB_XML_KEY, xmlText);
    } catch (e) {
      console.warn("Fintech SaaS: falha ao salvar o banco em XML; usando apenas o fallback em localStorage (JSON).", e);
      _xmlAvailable = false;
    }
  }

  // Grava também no arquivo local conectado (se houver), como o destino
  // "oficial" — é essa gravação que faz os dados migrarem de fato para o
  // arquivo dentro/fora da pasta database/ escolhida pelo usuário.
  if (typeof FileStore !== "undefined" && FileStore.isConnected()) {
    try {
      await FileStore.writeText(xmlText || dbToXmlString(db));
    } catch (e) {
      console.warn("Fintech SaaS: falha ao gravar no arquivo local conectado; os dados continuam salvos no localStorage.", e);
    }
  }
}

function nextId(db, collectionName) {
  db._seq[collectionName] = (db._seq[collectionName] || 0) + 1;
  return db._seq[collectionName];
}

function seedDefaultCategories(db, tenantId) {
  DEFAULT_CATEGORIES.forEach((name) => {
    const exists = db.categories.some((c) => c.tenant_id === tenantId && c.name === name);
    if (!exists) {
      db.categories.push({ id: nextId(db, "categories"), tenant_id: tenantId, name });
    }
  });
}

function nowIso() {
  return new Date().toISOString();
}
