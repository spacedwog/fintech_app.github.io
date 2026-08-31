package com.spacecworp.fintechapi.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public class AuthDtos {
    public record SignupRequest(
            @NotBlank String company_name,
            @NotBlank String admin_name,
            @NotBlank @Email String email,
            @NotBlank String password
    ) {}

    public record LoginRequest(
            @NotBlank @Email String email,
            @NotBlank String password
    ) {}

    public record RefreshRequest(@NotBlank String access_token) {}

    public record UserPayload(String id, String tenant_id, String name, String email, String role) {}

    public record AuthResponse(String token, UserPayload user) {}

    public record GenericResponse(boolean ok) {}
}
