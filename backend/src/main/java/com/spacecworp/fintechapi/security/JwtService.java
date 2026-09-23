package com.spacecworp.fintechapi.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Date;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class JwtService {
    private final SecretKey key;
    private final long ttlSeconds;
    private final Set<String> revokedTokenHashes = ConcurrentHashMap.newKeySet();

    public JwtService(
            @Value("${app.jwt.secret:change-me-in-prod-with-a-long-random-secret-value}") String secret,
            @Value("${app.jwt.ttl-seconds:3600}") long ttlSeconds
    ) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.ttlSeconds = ttlSeconds;
    }

    public String issue(AuthUser user) {
        return issueToken(
                user.userId(),
                ttlSeconds,
                Map.of(
                        "tenant_id", user.tenantId(),
                        "name", user.name(),
                        "email", user.email(),
                        "role", user.role(),
                        "scope", user.scope() == null ? List.of() : user.scope()
                ),
                null,
                null,
                null
        );
    }

    public String issueToken(
            String subject,
            long tokenTtlSeconds,
            Map<String, Object> claims,
            String issuer,
            String audience,
            String tokenType
    ) {
        Instant now = Instant.now();
        String tokenId = java.util.UUID.randomUUID().toString();
        var builder = Jwts.builder()
                .subject(subject)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(tokenTtlSeconds)))
                .id(tokenId)
                .claims(claims);
        if (issuer != null && !issuer.isBlank()) {
            builder.issuer(issuer);
        }
        if (audience != null && !audience.isBlank()) {
            builder.audience().add(audience).and();
        }
        if (tokenType != null && !tokenType.isBlank()) {
            builder.claim("token_type", tokenType);
        }
        return builder.signWith(key).compact();
    }

    public AuthUser parse(String token) {
        Claims claims = parseClaims(token);
        @SuppressWarnings("unchecked")
        List<String> scope = claims.get("scope", List.class);
        return new AuthUser(
                claims.getSubject(),
                claims.get("tenant_id", String.class),
                claims.get("name", String.class),
                claims.get("email", String.class),
                claims.get("role", String.class),
                scope == null ? List.of() : scope
        );
    }

    public Claims parseClaims(String token) {
        if (isRevoked(token)) {
            throw new JwtException("Token revogado");
        }
        return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
    }

    public void revokeToken(String token) {
        if (token == null || token.isBlank()) return;
        revokedTokenHashes.add(hash(token));
    }

    public boolean isRevoked(String token) {
        if (token == null || token.isBlank()) return false;
        return revokedTokenHashes.contains(hash(token));
    }

    private String hash(String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(token.trim().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hashed);
        } catch (Exception e) {
            throw new IllegalStateException("Falha ao gerar hash de token", e);
        }
    }
}
