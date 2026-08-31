package com.spacecworp.fintechapi.auth;

public class TenantDocument {
    public String id;
    public String name;
    public String created_at;

    public TenantDocument() {}

    public TenantDocument(String id, String name, String created_at) {
        this.id = id;
        this.name = name;
        this.created_at = created_at;
    }
}
