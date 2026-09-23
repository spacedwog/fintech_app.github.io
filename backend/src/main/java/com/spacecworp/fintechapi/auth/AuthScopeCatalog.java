package com.spacecworp.fintechapi.auth;

import java.util.List;
import java.util.stream.Stream;

public final class AuthScopeCatalog {
    private AuthScopeCatalog() {}

    public static final List<String> BASE_SCOPES = List.of(
            "profile:read",
            "profile:write",
            "categories:read",
            "categories:write",
            "expense_rules:read",
            "expense_rules:write",
            "expenses:read",
            "expenses:write",
            "budgets:read",
            "budgets:write",
            "reports:read",
            "payments:read",
            "payments:write",
            "plans:read",
            "team:read",
            "privacy:read",
            "privacy:write",
            "audit:read",
            "invoices:read",
            "marketplace:ai_agent"
    );

    public static final List<String> ADMIN_ONLY_SCOPES = List.of(
            "plans:write",
            "team:write",
            "oauth:clients:read",
            "oauth:clients:write"
    );

    public static List<String> forRole(String role) {
        if ("admin".equalsIgnoreCase(role)) {
            return Stream.concat(BASE_SCOPES.stream(), ADMIN_ONLY_SCOPES.stream()).distinct().toList();
        }
        return BASE_SCOPES;
    }
}
