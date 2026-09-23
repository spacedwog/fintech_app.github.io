package com.spacecworp.fintechapi.oauth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

public class SpacecworpOauthDtos {
    public record DiscoveryResponse(
            String issuer,
            String authorization_endpoint,
            String token_endpoint,
            String introspection_endpoint,
            String revocation_endpoint,
            String userinfo_endpoint,
            String registration_endpoint,
            List<String> grant_types_supported,
            List<String> response_types_supported,
            List<String> code_challenge_methods_supported,
            List<String> scopes_supported,
            String service_name,
            List<String> aliases,
            String company_name,
            String company_tax_id,
            String agent_ia_client_id
    ) {}

    public record CreateClientRequest(
            @NotBlank String name,
            @NotBlank String client_id,
            @NotBlank String client_type,
            @NotEmpty List<String> redirect_uris,
            List<String> allowed_scopes,
            String description,
            String application_url,
            Boolean ai_agent_enabled
    ) {}

    public record ClientRegistrationResponse(
            String id,
            String tenant_id,
            String name,
            String client_id,
            String client_type,
            String client_secret,
            List<String> redirect_uris,
            List<String> allowed_scopes,
            boolean first_party,
            boolean ai_agent_enabled,
            String created_at
    ) {}

    public record ClientView(
            String id,
            String tenant_id,
            String name,
            String client_id,
            String client_type,
            List<String> redirect_uris,
            List<String> allowed_scopes,
            boolean first_party,
            boolean ai_agent_enabled,
            String description,
            String application_url,
            String created_at
    ) {}

    public record AuthorizeRequest(
            @NotBlank String client_id,
            @NotBlank String redirect_uri,
            @NotBlank String response_type,
            @NotBlank String state,
            String scope,
            @NotBlank String code_challenge,
            @NotBlank String code_challenge_method,
            @NotBlank @Email String email,
            @NotBlank String password,
            Boolean oauth_consent
    ) {}

    public record AuthorizeResponse(
            String code,
            String state,
            String redirect_uri,
            String issuer,
            String client_id,
            String service_name
    ) {}

    public record TokenRequest(
            @NotBlank String grant_type,
            String code,
            String redirect_uri,
            String client_id,
            String client_secret,
            String code_verifier,
            String refresh_token
    ) {}

    public record TokenResponse(
            String access_token,
            String refresh_token,
            String token_type,
            long expires_in,
            String scope,
            String issuer,
            String client_id,
            String service_name,
            String company_name,
            String company_tax_id
    ) {}

    public record IntrospectRequest(
            @NotBlank String token,
            @NotBlank String client_id,
            String client_secret
    ) {}

    public record IntrospectResponse(
            boolean active,
            String scope,
            String client_id,
            String username,
            String token_type,
            long exp,
            long iat,
            String sub,
            String aud,
            String iss,
            String tenant_id,
            String service_name
    ) {}

    public record RevokeRequest(
            @NotBlank String token,
            @NotBlank String client_id,
            String client_secret
    ) {}

    public record UserInfoResponse(
            String sub,
            String tenant_id,
            String name,
            String email,
            String role,
            List<String> scope,
            String issuer,
            String service_name,
            String company_name,
            String company_tax_id
    ) {}
}
