package com.spacecworp.fintechapi.oauth;

import java.util.ArrayList;
import java.util.List;

public class OAuthClientDocument {
    public String id;
    public String tenant_id;
    public String name;
    public String client_id;
    public String client_type;
    public String client_secret_hash;
    public List<String> redirect_uris = new ArrayList<>();
    public List<String> allowed_scopes = new ArrayList<>();
    public boolean first_party;
    public boolean ai_agent_enabled;
    public String description;
    public String application_url;
    public String created_at;
    public String created_by_user_id;

    public OAuthClientDocument() {}
}
