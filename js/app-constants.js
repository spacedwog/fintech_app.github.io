(function (global) {
  if (!global) return;
  if (!global.__FINTECH_DB_KEY__) {
    global.__FINTECH_DB_KEY__ = "fintech_saas_db_v1";
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : null));
