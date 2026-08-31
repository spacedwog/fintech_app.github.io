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

    public ExpenseDocument() {}
}
