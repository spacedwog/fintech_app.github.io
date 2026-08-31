package com.spacecworp.fintechapi.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import java.util.List;

public class AuthDtos {
    public record SignupRequest(
            @NotBlank String company_name,
            @NotBlank String admin_name,
            @NotBlank @Email String email,
            @NotBlank String password
    ) {}

    public record LoginRequest(
            @NotBlank @Email String email,
            @NotBlank String password,
            Boolean oauth_consent
    ) {}

    public record RefreshRequest(@NotBlank String access_token) {}
    public record RevokeRequest(@NotBlank String token) {}

    public record UserPayload(String id, String tenant_id, String name, String email, String role, String tax_document, List<String> scope) {}

    public record TenantPayload(String id, String name, String plan) {}

    public record MeResponse(UserPayload user, TenantPayload tenant) {}

    public record AuthResponse(String token, UserPayload user) {}

    public record GenericResponse(boolean ok) {}
}
