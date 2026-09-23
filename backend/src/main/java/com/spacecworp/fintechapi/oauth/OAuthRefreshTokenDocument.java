package com.spacecworp.fintechapi.oauth;

import java.util.ArrayList;
import java.util.List;

public class OAuthRefreshTokenDocument {
    public String id;
    public String jti;
    public String client_id;
    public String user_id;
    public String tenant_id;
    public List<String> scope = new ArrayList<>();
    public String created_at;
    public String expires_at;
    public String revoked_at;
    public boolean revoked;

    public OAuthRefreshTokenDocument() {}
}
