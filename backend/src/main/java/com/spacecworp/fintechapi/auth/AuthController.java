package com.spacecworp.fintechapi.auth;

import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.SecurityUtils;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import com.spacecworp.fintechapi.common.ApiException;
import com.spacecworp.fintechapi.security.JwtService;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final AuthService authService;
    private final JwtService jwtService;

    public AuthController(AuthService authService, JwtService jwtService) {
        this.authService = authService;
        this.jwtService = jwtService;
    }

    @PostMapping("/signup")
    public AuthDtos.AuthResponse signup(@Valid @RequestBody AuthDtos.SignupRequest request) {
        return authService.signup(request);
    }

    @PostMapping("/login")
    public AuthDtos.AuthResponse login(@Valid @RequestBody AuthDtos.LoginRequest request) {
        return authService.login(request);
    }

    @PostMapping("/refresh")
    public AuthDtos.AuthResponse refresh(@Valid @RequestBody AuthDtos.RefreshRequest request) {
        return authService.refresh(request);
    }

    @PostMapping("/logout")
    public AuthDtos.GenericResponse logout(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authHeader) {
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            jwtService.revokeToken(authHeader.substring(7));
        }
        return new AuthDtos.GenericResponse(true);
    }

    @PostMapping("/revoke")
    public AuthDtos.GenericResponse revoke(@Valid @RequestBody AuthDtos.RevokeRequest request) {
        if (request.token() == null || request.token().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Token obrigatório");
        }
        jwtService.revokeToken(request.token());
        return new AuthDtos.GenericResponse(true);
    }

    @GetMapping("/me")
    public AuthDtos.MeResponse me() {
        AuthUser user = SecurityUtils.currentUser();
        return authService.me(user);
    }
}
