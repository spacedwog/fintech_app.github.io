export type Role = "admin" | "member";

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  tax_document?: string | null;
  scope?: string[];
}

export interface PlanDetails {
  label: string;
  price_month: number;
  max_users: number;
  max_expenses_day: number;
  max_budget_imports_day: number;
  overage_price: number;
  budget_import_overage_price: number;
}

export interface Tenant {
  id: string;
  name: string;
  plan: string;
  plan_details: PlanDetails;
}

export interface MeResponse {
  user: User;
  tenant: Tenant;
}

export interface Expense {
  id: string;
  amount: number;
  date: string;
  description: string;
  transaction_number?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  generated_by_mercado_pago?: boolean;
}

export interface Payment {
  id: string;
  type: string;
  plan?: string | null;
  amount: number;
  date: string;
  txid?: string | null;
  verifiedByMercadoPago?: boolean;
  manualTxnNumber?: string | null;
}

export interface Category {
  id: string;
  name: string;
}

export interface BudgetRow {
  category_name: string;
  month: string;
  previsto: number;
  realizado?: number;
}

export interface Invoice {
  id: string;
  number?: string;
  issued_at?: string;
  amount?: number;
  status?: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  actor_name?: string;
  created_at: string;
}

export interface ReportBundle {
  month: string;
  kpis?: Array<{ key: string; valueText: string; status: string }>;
  monthly_close_checklist?: { checklist: Array<{ id: string; label: string; done: boolean }> };
}
