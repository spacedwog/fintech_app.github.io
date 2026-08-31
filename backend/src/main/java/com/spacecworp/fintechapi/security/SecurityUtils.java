package com.spacecworp.fintechapi.security;

import com.spacecworp.fintechapi.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

public final class SecurityUtils {
    private SecurityUtils() {}

    public static AuthUser currentUser() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthUser user)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Não autenticado");
        }
        return user;
    }

    public static void requireAdmin(AuthUser user) {
        if (!"admin".equalsIgnoreCase(user.role())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Apenas administradores podem executar esta ação");
        }
    }
}
