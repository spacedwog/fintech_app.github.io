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
// ===============================

const DB_XML_KEY = "fintech_saas_db_xml_v1"; // banco "oficial" (XML)
const DB_JSON_KEY = "fintech_saas_db_v1"; // fallback / cópia de segurança (JSON)

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

// ---------- API pública (mesma interface de antes) ----------

function loadDb() {
  // 1) Fonte primária: banco XML.
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

  // 2) Fallback: JSON em localStorage (primeira execução, XML indisponível
  //    ou XML corrompido). Se achar dados aqui e o XML ainda for suportado,
  //    já migra/regrava no formato XML para as próximas leituras.
  const legacy = _readJsonFallback();
  if (legacy) {
    if (_xmlAvailable) saveDb(legacy);
    return legacy;
  }

  const fresh = _emptySchema();
  saveDb(fresh);
  return fresh;
}

function saveDb(db) {
  // Sempre atualiza a cópia de segurança em JSON, mesmo quando o XML
  // funciona — assim nunca há perda de dados se o XML falhar depois.
  _writeJsonFallback(db);

  if (_xmlAvailable) {
    try {
      localStorage.setItem(DB_XML_KEY, dbToXmlString(db));
    } catch (e) {
      console.warn("Fintech SaaS: falha ao salvar o banco em XML; usando apenas o fallback em localStorage (JSON).", e);
      _xmlAvailable = false;
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
