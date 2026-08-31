package com.spacecworp.fintechapi.governance;

import java.util.Map;

public class AuditEventDocument {
    public String id;
    public String tenant_id;
    public String user_id;
    public String action;
    public String entity;
    public String entity_id;
    public String message;
    public String created_at;
    public Map<String, Object> metadata;

    public AuditEventDocument() {
    }
}
