// ===============================
// tests/ads-api.test.js
//
// Teste de integração da API de anúncios (js/api.js):
// - createAd / listAds / updateAd / deleteAd
// - filtro onlyActive + placement
// - restrição de escrita para admin
// - isolamento por tenant
//
// Como rodar:
//   node tests/ads-api.test.js
// ===============================

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

const placeholderFirebaseConfigSrc = read("js/firebase-config.js")
  .replace(/apiKey:\s*"[^"]+"/, 'apiKey: "SUA_API_KEY"')
  .replace(/projectId:\s*"[^"]+"/, 'projectId: "SEU_PROJETO"');

const appBundleSrc = [placeholderFirebaseConfigSrc, read("js/plans.js"), read("js/db.js"), read("js/crypto-utils.js"), read("js/oauth.js"), read("js/api.js")].join(
  "\n;\n"
);

function buildDevice(label) {
  const localStorage = makeLocalStorage();
  const sandbox = {
    console,
    crypto: globalThis.crypto,
    TextEncoder,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
    localStorage,
    window: { addEventListener() {} },
    setTimeout,
    clearTimeout,
    Promise,
    fetch: undefined,
    firebase: undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(appBundleSrc, sandbox, { filename: `${label}.js` });
  return { label, ctx: sandbox, localStorage };
}

function run(device, stepFn) {
  if (typeof stepFn !== "function") throw new Error("run requer uma função async.");
  device.ctx.__adsApiStep = stepFn;
  return vm.runInContext(
    `(async () => {
      try {
        return await __adsApiStep({ Api, Auth, loadDb, saveDb, nextId });
      } finally {
        __adsApiStep = undefined;
      }
    })()`,
    device.ctx,
    { filename: `${device.label}-step.js` }
  );
}

const results = [];
function check(name, cond) {
  results.push({ name, ok: !!cond });
  console.log((cond ? "OK  " : "FAIL") + " - " + name);
}

(async () => {
  const dev = buildDevice("ads-api");

  await run(dev, async ({ Api, Auth }) => {
    const signup = await Api.signup({
      company_name: "Empresa Ads",
      admin_name: "Admin Ads",
      email: "admin.ads@example.com",
      password: "senha-forte-123",
    });
    Auth.setToken(signup.token);
  });

  const created = await run(dev, async ({ Api }) => {
    return Api.createAd({
      title: "Plano Premium com 20% OFF",
      description: "Promoção por tempo limitado",
      image_url: "https://cdn.example.com/banner.png",
      target_url: "https://example.com/premium",
      cta_label: "Assinar agora",
      placement: "landing",
      is_active: true,
    });
  });
  check("createAd cria anúncio com id", !!(created && created.id));
  check("createAd salva placement informado", created.placement === "landing");

  const listedActive = await run(dev, async ({ Api }) => Api.listAds({ onlyActive: true, placement: "landing" }));
  check("listAds filtra onlyActive + placement", Array.isArray(listedActive) && listedActive.length === 1 && listedActive[0].id === created.id);

  const updated = await run(dev, async ({ Api }) => {
    return Api.updateAd(created.id, {
      is_active: false,
      target_url: "https://example.com/premium-novo",
    });
  });
  check("updateAd altera target_url", updated.target_url === "https://example.com/premium-novo");
  check("updateAd altera is_active", updated.is_active === false);

  const listedAfterDisable = await run(dev, async ({ Api }) => Api.listAds({ onlyActive: true }));
  check("listAds onlyActive ignora anúncio inativo", Array.isArray(listedAfterDisable) && listedAfterDisable.length === 0);

  const deletion = await run(dev, async ({ Api }) => Api.deleteAd(created.id));
  check("deleteAd remove anúncio", deletion && deletion.ok === true);

  const listedAfterDelete = await run(dev, async ({ Api }) => Api.listAds());
  check("listAds vazio após delete", Array.isArray(listedAfterDelete) && listedAfterDelete.length === 0);

  const memberCannotCreate = await run(dev, async ({ Api, Auth }) => {
    await Api.inviteUser({
      name: "Membro Ads",
      email: "membro.ads@example.com",
      password: "senha-forte-123",
      role: "member",
    });
    Auth.clearToken();
    const login = await Api.login({ email: "membro.ads@example.com", password: "senha-forte-123" });
    Auth.setToken(login.token);
    try {
      await Api.createAd({ title: "Teste", target_url: "https://example.com" });
      return { blocked: false };
    } catch (err) {
      return { blocked: /administradores/.test(String(err.message || "")) };
    }
  });
  check("member não pode createAd", memberCannotCreate.blocked === true);

  const otherTenantIsolation = await run(dev, async ({ Api, Auth }) => {
    Auth.clearToken();
    const signup2 = await Api.signup({
      company_name: "Empresa B",
      admin_name: "Admin B",
      email: "admin.b@example.com",
      password: "senha-forte-123",
    });
    Auth.setToken(signup2.token);
    const list = await Api.listAds();
    return { count: list.length };
  });
  check("anúncios isolados por tenant", otherTenantIsolation.count === 0);

  console.log("\n=== RESUMO ===");
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${total} verificações passaram.`);
  if (passed !== total) {
    console.log("\nFalharam:");
    results.filter((r) => !r.ok).forEach((r) => console.log("  - " + r.name));
    process.exit(1);
  }
})().catch((err) => {
  console.error("Erro inesperado no teste:", err);
  process.exit(1);
});
