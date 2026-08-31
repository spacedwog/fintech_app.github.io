package com.spacecworp.fintechapi.budgets;

public class CategoryBudgetDocument {
    public String id;
    public String tenant_id;
    public String category_id;
    public String category_name;
    public String month;
    public double previsto;
    public Boolean imported_from_budget;

    public CategoryBudgetDocument() {}
}
