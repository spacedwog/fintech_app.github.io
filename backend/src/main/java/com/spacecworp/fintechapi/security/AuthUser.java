package com.spacecworp.fintechapi.security;

import java.util.List;

public record AuthUser(
        String userId,
        String tenantId,
        String name,
        String email,
        String role,
        List<String> scope
) {}
