package com.spacecworp.fintechapi.expenses;

public class ExpenseDocument {
    public String id;
    public String tenant_id;
    public String user_id;
    public double amount;
    public String date;
    public String description;
    public String category_id;
    public String transaction_number;
    public boolean generated_by_mercado_pago;
    public String generated_by_mercado_pago_source;
    public String mercado_pago_payment_id;
    public String created_at;
    public boolean auto_categorized_by_rule;
    public boolean is_extra;
    public double extra_charge;

    public ExpenseDocument() {}
}
