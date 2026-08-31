package com.spacecworp.fintechapi.auth;

public class TenantDocument {
    public String id;
    public String name;
    public String plan;
    public String created_at;

    public TenantDocument() {}

    public TenantDocument(String id, String name, String created_at) {
        this.id = id;
        this.name = name;
        this.plan = null;
        this.created_at = created_at;
    }
}
