package com.spacecworp.fintechapi.oauth;

import java.util.ArrayList;
import java.util.List;

public class OAuthAuthorizationCodeDocument {
    public String id;
    public String client_id;
    public String user_id;
    public String tenant_id;
    public String redirect_uri;
    public String code_challenge;
    public String code_challenge_method;
    public List<String> scope = new ArrayList<>();
    public String state;
    public String created_at;
    public String expires_at;

    public OAuthAuthorizationCodeDocument() {}
}
