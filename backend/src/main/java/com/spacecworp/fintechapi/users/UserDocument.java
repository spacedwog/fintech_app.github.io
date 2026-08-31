package com.spacecworp.fintechapi.users;

public class UserDocument {
    public String id;
    public String tenant_id;
    public String name;
    public String email;
    public String password;
    public String role;
    public String tax_document;
    public Boolean consent_marketing;
    public String consent_updated_at;
    public String created_at;

    public UserDocument() {}

    public UserDocument(String id, String tenant_id, String name, String email, String password, String role, String created_at) {
        this.id = id;
        this.tenant_id = tenant_id;
        this.name = name;
        this.email = email;
        this.password = password;
        this.role = role;
        this.tax_document = null;
        this.consent_marketing = false;
        this.consent_updated_at = null;
        this.created_at = created_at;
    }
}
