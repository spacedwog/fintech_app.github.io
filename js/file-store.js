// ===============================
// js/file-store.js
// Conexão com um ARQUIVO LOCAL de verdade (no computador do usuário), via
// File System Access API — suportada em Chrome/Edge (e derivados Chromium).
// Uma vez conectado, esse arquivo .xml passa a ser o banco de dados "real":
// js/db.js lê e grava nele a cada operação, automaticamente.
//
// O handle do arquivo é guardado no IndexedDB para reconectar sozinho nas
// próximas visitas (sem precisar escolher o arquivo de novo toda vez), mas
// o navegador exige permissão explícita do usuário pelo menos uma vez por
// sessão — por isso existe requestPermission(), pensado para ser chamado a
// partir de um clique (ex.: botão "Reconectar arquivo").
//
// Navegadores sem suporte (Firefox, Safari, iOS) simplesmente não têm essa
// opção disponível: isSupported() retorna false e o app inteiro continua
// funcionando normalmente com localStorage (ver js/db.js).
//
// IMPORTANTE: isso conecta um arquivo no computador de quem está usando o
// navegador — não é (e não pode ser) o arquivo database/db.xml hospedado no
// GitHub Pages. Um site 100% estático não tem como escrever de volta num
// arquivo remoto; a conexão de arquivo local é a forma real de ter
// leitura/gravação em disco a partir do navegador.
// ===============================

const FILE_STORE_IDB_NAME = "fintech_saas_file_handles";
const FILE_STORE_STORE_NAME = "handles";
const FILE_STORE_HANDLE_KEY = "db_file_handle";

const FileStore = {
  _handle: null, // cache em memória, válido durante a sessão/aba atual

  isSupported() {
    return (
      typeof window !== "undefined" &&
      !!window.showSaveFilePicker &&
      !!window.showOpenFilePicker &&
      !!window.indexedDB
    );
  },

  isConnected() {
    return !!this._handle;
  },

  fileName() {
    return this._handle ? this._handle.name : null;
  },

  _openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(FILE_STORE_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(FILE_STORE_STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async _getStoredHandle() {
    if (!this.isSupported()) return null;
    try {
      const idb = await this._openIdb();
      return await new Promise((resolve, reject) => {
        const tx = idb.transaction(FILE_STORE_STORE_NAME, "readonly");
        const req = tx.objectStore(FILE_STORE_STORE_NAME).get(FILE_STORE_HANDLE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return null;
    }
  },

  async _persistHandle(handle) {
    if (!this.isSupported()) return;
    try {
      const idb = await this._openIdb();
      await new Promise((resolve, reject) => {
        const tx = idb.transaction(FILE_STORE_STORE_NAME, "readwrite");
        if (handle) tx.objectStore(FILE_STORE_STORE_NAME).put(handle, FILE_STORE_HANDLE_KEY);
        else tx.objectStore(FILE_STORE_STORE_NAME).delete(FILE_STORE_HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn("Fintech SaaS: não foi possível salvar a referência do arquivo local.", e);
    }
  },

  // Cria um arquivo novo (ex.: db.xml) e já grava o conteúdo atual do banco
  // nele — é assim que os dados que estavam só no localStorage são migrados
  // para o arquivo. Precisa ser chamado a partir de um clique do usuário.
  async connectNew(initialContent) {
    if (!this.isSupported()) throw new Error("Este navegador não suporta conectar um arquivo local.");
    const handle = await window.showSaveFilePicker({
      suggestedName: "db.xml",
      types: [{ description: "Banco de dados Fintech SaaS (XML)", accept: { "application/xml": [".xml"] } }],
    });
    await this._writeToHandle(handle, initialContent);
    await this._persistHandle(handle);
    this._handle = handle;
    return handle;
  },

  // Conecta um arquivo .xml já existente (ex.: um db.xml salvo/exportado
  // antes). O conteúdo desse arquivo passa a valer como banco de dados.
  async connectExisting() {
    if (!this.isSupported()) throw new Error("Este navegador não suporta conectar um arquivo local.");
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "Banco de dados Fintech SaaS (XML)", accept: { "application/xml": [".xml"] } }],
    });
    await this._persistHandle(handle);
    this._handle = handle;
    return handle;
  },

  async disconnect() {
    this._handle = null;
    await this._persistHandle(null);
  },

  // Usado pela UI para saber se existe um arquivo autorizado anteriormente
  // (mesmo que a permissão ainda precise ser repedida com um clique).
  async hasStoredHandle() {
    const stored = await this._getStoredHandle();
    return !!stored;
  },

  async storedFileName() {
    const stored = await this._getStoredHandle();
    return stored ? stored.name : null;
  },

  // Tenta reconectar em silêncio (sem prompt) a um arquivo já autorizado
  // antes nesta mesma sessão do navegador. Chamado automaticamente ao
  // carregar a página.
  async tryReconnect() {
    if (this._handle) return this._handle;
    const stored = await this._getStoredHandle();
    if (!stored) return null;
    try {
      const granted = (await stored.queryPermission({ mode: "readwrite" })) === "granted";
      if (granted) {
        this._handle = stored;
        return stored;
      }
      return null; // precisa de requestPermission() a partir de um clique
    } catch (e) {
      return null;
    }
  },

  // Pede permissão de novo (precisa ser chamado a partir de um clique).
  async requestPermission() {
    const stored = (await this._getStoredHandle()) || this._handle;
    if (!stored) return false;
    try {
      const granted = (await stored.requestPermission({ mode: "readwrite" })) === "granted";
      if (granted) this._handle = stored;
      return granted;
    } catch (e) {
      return false;
    }
  },

  async readText() {
    if (!this._handle) return null;
    const file = await this._handle.getFile();
    return await file.text();
  },

  async _writeToHandle(handle, text) {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  },

  async writeText(text) {
    if (!this._handle) throw new Error("Nenhum arquivo local conectado.");
    await this._writeToHandle(this._handle, text);
  },
};
