import type {
  AuthTokens,
  BudgetRow,
  Category,
  Expense,
  Invoice,
  MeResponse,
  Payment,
  ReportBundle,
  Tenant,
  User,
} from "./contracts";
import { clearSession, loadSession, saveSession } from "../auth/sessionStore";
import { enqueueAction, loadQueue, setQueue } from "../utils/offlineQueue";
import { logEvent } from "../utils/telemetry";

const isWriteMethod = (method: string) => ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());

export class ApiClient {
  constructor(private baseUrl: string) {}

  setBaseUrl(next: string) {
    this.baseUrl = next.replace(/\/+$/, "");
  }

  private async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const tokens = await loadSession();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (tokens?.access_token) headers.Authorization = "Bearer " + tokens.access_token;

    try {
      const resp = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!resp.ok) {
        let message = `Erro HTTP ${resp.status}`;
        try {
          const data = await resp.json();
          if (data?.message) message = String(data.message);
        } catch {
          // noop
        }
        if (resp.status === 401 && path !== "/api/v1/auth/login" && path !== "/api/v1/auth/refresh") {
          await this.tryRefreshSession();
          return this.request<T>(path, method, body);
        }
        throw new Error(message);
      }
      if (resp.status === 204) return null as T;
      return (await resp.json()) as T;
    } catch (error) {
      if (isWriteMethod(method)) {
        await enqueueAction({ method, path, body });
      }
      logEvent("error", "api.request.failed", (error as Error).message, { path, method });
      throw error;
    }
  }

  async syncOfflineQueue() {
    const queue = await loadQueue();
    const remaining = [...queue];
    for (const item of queue.reverse()) {
      try {
        await this.request(item.path, item.method, item.body);
        const idx = remaining.findIndex((x) => x.id === item.id);
        if (idx >= 0) remaining.splice(idx, 1);
      } catch {
        break;
      }
    }
    await setQueue(remaining);
    return { synced: queue.length - remaining.length, pending: remaining.length };
  }

  async signup(payload: { company_name: string; admin_name: string; email: string; password: string }) {
    return this.request<{ token?: string; access_token?: string; refresh_token?: string }>("/api/v1/auth/signup", "POST", payload);
  }

  async login(payload: { email: string; password: string; oauth_consent: boolean }) {
    return this.request<{ token?: string; access_token?: string; refresh_token?: string }>("/api/v1/auth/login", "POST", payload);
  }

  async me() {
    return this.request<MeResponse>("/api/v1/auth/me");
  }

  async logout() {
    await this.request("/api/v1/auth/logout", "POST").catch(() => null);
    await clearSession();
  }

  async tryRefreshSession() {
    const current = await loadSession();
    if (!current?.access_token) return false;
    try {
      const fresh = await this.request<{ token?: string; access_token?: string; refresh_token?: string }>(
        "/api/v1/auth/refresh",
        "POST",
        { access_token: current.access_token },
      );
      const normalized: AuthTokens =
        fresh.access_token && fresh.refresh_token
          ? {
              access_token: fresh.access_token,
              refresh_token: fresh.refresh_token,
              token_type: "Bearer",
            }
          : fresh.token
            ? (JSON.parse(fresh.token) as AuthTokens)
            : current;
      await saveSession(normalized);
      return true;
    } catch {
      await clearSession();
      return false;
    }
  }

  async plans() {
    return this.request<Record<string, Tenant["plan_details"]>>("/api/v1/plans");
  }

  async changePlan(plan: string) {
    return this.request<Tenant>("/api/v1/plans/change", "POST", { plan });
  }

  async listUsers() {
    return this.request<User[]>("/api/v1/users");
  }

  async inviteUser(payload: { name: string; email: string; password: string; role: "admin" | "member" }) {
    return this.request<User>("/api/v1/users/invite", "POST", payload);
  }

  async updateUserRole(id: string, role: "admin" | "member") {
    return this.request<User>(`/api/v1/users/${encodeURIComponent(id)}/role`, "PATCH", { role });
  }

  async listCategories() {
    return this.request<Category[]>("/api/v1/categories");
  }

  async addCategory(name: string) {
    return this.request<{ ok: boolean }>("/api/v1/categories", "POST", { name });
  }

  async listExpenseRules() {
    return this.request<Array<{ id: string; category_id: string; keyword: string; match_type: string }>>("/api/v1/expense-rules");
  }

  async addExpenseRule(payload: { category_id: string; keyword: string; match_type: string }) {
    return this.request<{ ok: boolean }>("/api/v1/expense-rules", "POST", payload);
  }

  async deleteExpenseRule(id: string) {
    return this.request<{ ok: boolean }>(`/api/v1/expense-rules/${encodeURIComponent(id)}`, "DELETE");
  }

  async applyExpenseRulesToUncategorized(month?: string) {
    return this.request<{ updated: number }>("/api/v1/expenses/apply-rules", "POST", month ? { month } : {});
  }

  async listExpenses(allUsers = false) {
    return this.request<Expense[]>(`/api/v1/expenses?allUsers=${allUsers ? "true" : "false"}`);
  }

  async addExpense(payload: { amount: number; date: string; description: string; category_id?: string | null; transaction_number?: string }) {
    return this.request<{ id: string }>("/api/v1/expenses", "POST", payload);
  }

  async updateExpense(id: string, payload: { amount: number; date: string; description: string; category_id?: string | null; transaction_number?: string }) {
    return this.request<{ ok: boolean }>(`/api/v1/expenses/${encodeURIComponent(id)}`, "PUT", payload);
  }

  async deleteExpense(id: string) {
    return this.request<{ ok: boolean }>(`/api/v1/expenses/${encodeURIComponent(id)}`, "DELETE");
  }

  async listBudgets(month?: string) {
    return this.request<Array<{ id: string; month: string; limit_value: number }>>(`/api/v1/budgets${month ? `?month=${encodeURIComponent(month)}` : ""}`);
  }

  async setBudget(payload: { month: string; limit_value: number }) {
    return this.request<{ ok: boolean }>("/api/v1/budgets", "POST", payload);
  }

  async getAlerts(month?: string) {
    return this.request<{ month: string; status: string; ratio: number; total_spent: number; limit_value: number }>(`/api/v1/alerts${month ? `?month=${encodeURIComponent(month)}` : ""}`);
  }

  async listCategoryBudgets(month?: string) {
    return this.request<BudgetRow[]>(`/api/v1/category-budgets${month ? `?month=${encodeURIComponent(month)}` : ""}`);
  }

  async importCategoryBudgets(payload: { month: string; rows: BudgetRow[] }) {
    return this.request<{ imported: number }>("/api/v1/category-budgets/import", "POST", payload);
  }

  async setCategoryBudget(payload: { budget_id?: string; category_id?: string; category_name: string; month: string; previsto: number }) {
    return this.request<BudgetRow>("/api/v1/category-budgets", "POST", payload);
  }

  async deleteCategoryBudget(id: string) {
    return this.request<{ ok: boolean }>(`/api/v1/category-budgets/${encodeURIComponent(id)}`, "DELETE");
  }

  async getBudgetImportQuota() {
    return this.request<{ limit: number; used: number; remaining: number }>("/api/v1/category-budgets/quota");
  }

  async getBudgetOverview(month?: string) {
    return this.request<{ month: string; rows: BudgetRow[]; overBudget: boolean; hasAnyBudget: boolean }>(`/api/v1/category-budgets/overview${month ? `?month=${encodeURIComponent(month)}` : ""}`);
  }

  async copyCategoryBudgetsRecurring(payload: { targetMonth: string; sourceMonth?: string; adjustmentPercent?: number }) {
    return this.request<{ copied: number }>("/api/v1/category-budgets/copy-recurring", "POST", payload);
  }

  async listBudgetGroups() {
    return this.request<Array<{ id: string; name: string; category_ids: string[] }>>("/api/v1/budget-groups");
  }

  async listBudgetLayouts() {
    return this.request<Array<{ id: string; name?: string; format_type?: string }>>("/api/v1/budget-layouts");
  }

  async saveBudgetLayout(payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>("/api/v1/budget-layouts", "POST", payload);
  }

  async deleteBudgetLayout(id: string) {
    return this.request<{ ok: boolean }>(`/api/v1/budget-layouts/${encodeURIComponent(id)}`, "DELETE");
  }

  async listPayments(allUsers = false) {
    return this.request<Payment[]>(`/api/v1/payments?allUsers=${allUsers ? "true" : "false"}`);
  }

  async addPayment(payload: { type: string; plan?: string; amount: number; txid?: string; manualTxnNumber?: string; verifiedByAI?: boolean; aiClassification?: string }) {
    return this.request<Payment>("/api/v1/payments", "POST", payload);
  }

  async analyzeReceiptText(payload: { text: string }) {
    return this.request<{ classification: string; score: number; txid?: string }>("/api/v1/payments/receipt/analyze-text", "POST", { rawText: payload.text });
  }

  async confirmPayment(id: string, payload: { verifiedByMercadoPago?: boolean; txid?: string; mercadoPagoPaymentId?: string } = {}) {
    return this.request<Payment>(`/api/v1/payments/${encodeURIComponent(id)}/confirm`, "POST", payload);
  }

  async reconcileMercadoPago(payload: { txid?: string; mercadoPagoPaymentId?: string; manualTxnNumber?: string }) {
    return this.request<{ ok: boolean; matched: boolean; message?: string; payment_id?: string }>("/api/v1/payments/reconcile/mercado-pago", "POST", payload);
  }

  async getReconciliationStatus() {
    return this.request<{ total: number; verified_by_mercado_pago: number; verified_by_ai: number; manual_or_pending: number }>(
      "/api/v1/payments/reconciliation/status",
    );
  }

  async getMercadoPagoStatus() {
    return this.request<{ connected: boolean; expenses_count: number; expenses_total: number; payments_verified_count: number; last_sync_date?: string }>("/api/v1/payments/mercado-pago/status");
  }

  async verifyMercadoPagoTransactionId(transactionId: string) {
    try {
      return await this.request<{ query: string; found: boolean; status: string; message: string; summary: { expenses: number; payments: number; rejections: number } }>(
        "/api/v1/payments/mercado-pago/verify",
        "POST",
        { transactionId },
      );
    } catch {
      const [expenses, payments] = await Promise.all([this.listExpenses(true), this.listPayments(true)]);
      const q = String(transactionId || "").trim().toUpperCase();
      const inExpenses = expenses.filter(
        (e) => String(e.transaction_number || "").trim().toUpperCase() === q || String((e as Expense & { mercadoPagoPaymentId?: string }).mercadoPagoPaymentId || "").trim().toUpperCase() === q,
      );
      const inPayments = payments.filter(
        (p) =>
          String(p.txid || "").trim().toUpperCase() === q
          || String(p.manualTxnNumber || "").trim().toUpperCase() === q
          || String((p as Payment & { mercadoPagoPaymentId?: string }).mercadoPagoPaymentId || "").trim().toUpperCase() === q,
      );
      const verified = inPayments.some((p) => !!p.verifiedByMercadoPago);
      const found = inExpenses.length > 0 || inPayments.length > 0;
      return {
        query: transactionId,
        found,
        status: verified ? "verified" : found ? "found" : "not_found",
        message: verified ? "ID encontrado e confirmado pelo Mercado Pago." : found ? "ID encontrado nos registros da conta." : "ID não encontrado nos registros da conta.",
        summary: {
          expenses: inExpenses.length,
          payments: inPayments.length,
          rejections: 0,
        },
      };
    }
  }

  async monthlyReport(allUsers = false) {
    return this.request<unknown>(`/api/v1/reports/monthly?allUsers=${allUsers ? "true" : "false"}`);
  }

  async categoryReport(allUsers = false) {
    return this.request<unknown>(`/api/v1/reports/category?allUsers=${allUsers ? "true" : "false"}`);
  }

  async getMonthlyProjection(month?: string) {
    return this.request<unknown>(`/api/v1/reports/projection${month ? `?month=${encodeURIComponent(month)}` : ""}`);
  }

  async getMonthlyCloseChecklist(month?: string) {
    return this.request<unknown>(`/api/v1/reports/monthly-close-checklist${month ? `?month=${encodeURIComponent(month)}` : ""}`);
  }

  async getConsolidatedExportData(month?: string) {
    return this.request<ReportBundle>(`/api/v1/reports/consolidated-export${month ? `?month=${encodeURIComponent(month)}` : ""}`);
  }

  async getTransactionOriginReport(month?: string) {
    return this.request<unknown>(`/api/v1/reports/transaction-origin${month ? `?month=${encodeURIComponent(month)}` : ""}`);
  }

  async listInvoices() {
    try {
      return await this.request<Invoice[]>("/api/v1/invoices");
    } catch {
      const payments = await this.listPayments(true);
      return payments
        .filter((p) => !!p.plan || p.type === "pix")
        .map((p) => ({
          id: p.id,
          number: p.txid || p.id,
          issued_at: p.date,
          amount: p.amount,
          status: p.verifiedByMercadoPago ? "emitido" : "pendente",
        }));
    }
  }

  async listAuditTrail(limit = 50) {
    return this.request<Array<{ id: string; action: string; actor_name?: string; created_at: string }>>(`/api/v1/audit-trail?limit=${limit}`);
  }

  async updateProfile(payload: { name: string; document?: string }) {
    return this.request<User>("/api/v1/users/me", "PUT", payload);
  }

  async changePassword(payload: { currentPassword: string; newPassword: string }) {
    return this.request<{ ok: boolean }>("/api/v1/users/me/change-password", "POST", payload);
  }

  async getCompanyProfile() {
    return this.request<{ summary: string }>("/api/v1/company-profile");
  }

  async getPrivacyConsent() {
    return this.request<{ consent_marketing: boolean; consent_updated_at?: string }>("/api/v1/privacy-consent");
  }

  async setPrivacyConsent(marketing: boolean) {
    return this.request<{ consent_marketing: boolean; consent_updated_at?: string }>("/api/v1/privacy-consent", "POST", { consent_marketing: marketing });
  }

  async exportMyData() {
    return this.request<Record<string, unknown>>("/api/v1/my-data/export");
  }

  async deleteAccount() {
    return this.request<{ ok: boolean }>("/api/v1/account", "DELETE");
  }
}
