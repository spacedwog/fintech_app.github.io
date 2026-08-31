package com.spacecworp.fintechapi.expenses;

public class CategoryDocument {
    public String id;
    public String tenant_id;
    public String name;

    public CategoryDocument() {}

    public CategoryDocument(String id, String tenant_id, String name) {
        this.id = id;
        this.tenant_id = tenant_id;
        this.name = name;
    }
}
