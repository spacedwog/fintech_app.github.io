package com.spacecworp.fintechapi.oauth;

import com.spacecworp.fintechapi.auth.AuthScopeCatalog;
import com.spacecworp.fintechapi.common.ApiException;
import com.spacecworp.fintechapi.firestore.DocumentGateway;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.JwtService;
import com.spacecworp.fintechapi.users.UserDocument;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

@Service
public class SpacecworpOauthService {
    public static final String SERVICE_NAME = "SpacecworpOauth";
    public static final String COMPANY_NAME = "SPACECWORP";
    public static final String COMPANY_TAX_ID = "62.904.267/0001-60";
    public static final List<String> ALIASES = List.of("SpaceOauth", "CworpOauth");
    private static final String PLATFORM_TENANT = "__spacecworp_platform__";
    private static final String DASHBOARD_CLIENT_ID = "fintech-spacecworp-dashboard";
    private static final String AGENT_IA_CLIENT_ID = "spacecworpoauth-agent-ia";
    private static final long ACCESS_TTL_SECONDS = 3600;
    private static final long REFRESH_TTL_SECONDS = 60L * 60 * 24 * 30;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final DocumentGateway documents;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public SpacecworpOauthService(DocumentGateway documents, PasswordEncoder passwordEncoder, JwtService jwtService) {
        this.documents = documents;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    public SpacecworpOauthDtos.DiscoveryResponse discovery(String issuer) {
        ensurePlatformClients();
        return new SpacecworpOauthDtos.DiscoveryResponse(
                issuer,
                issuer + "/authorize",
                issuer + "/token",
                issuer + "/introspect",
                issuer + "/revoke",
                issuer + "/userinfo",
                issuer + "/clients",
                List.of("authorization_code", "refresh_token"),
                List.of("code"),
                List.of("S256"),
                AuthScopeCatalog.forRole("admin"),
                SERVICE_NAME,
                ALIASES,
                COMPANY_NAME,
                COMPANY_TAX_ID,
                AGENT_IA_CLIENT_ID
        );
    }

    public SpacecworpOauthDtos.ClientRegistrationResponse registerClient(AuthUser currentUser, SpacecworpOauthDtos.CreateClientRequest request) {
        ensureAdmin(currentUser);
        ensurePlatformClients();

        String normalizedClientType = normalizeClientType(request.client_type());
        if (findClientByClientId(request.client_id(), currentUser.tenantId()).isPresent()) {
            throw new ApiException(HttpStatus.CONFLICT, "client_id já cadastrado");
        }

        OAuthClientDocument doc = new OAuthClientDocument();
        doc.id = documents.nextId(SpacecworpOauthCollections.CLIENTS);
        doc.tenant_id = currentUser.tenantId();
        doc.name = request.name().trim();
        doc.client_id = request.client_id().trim();
        doc.client_type = normalizedClientType;
        doc.redirect_uris = sanitizeRedirectUris(request.redirect_uris());
        doc.allowed_scopes = sanitizeScopes(request.allowed_scopes(), AuthScopeCatalog.forRole(currentUser.role()));
        doc.first_party = false;
        doc.ai_agent_enabled = Boolean.TRUE.equals(request.ai_agent_enabled());
        doc.description = blankToNull(request.description());
        doc.application_url = blankToNull(request.application_url());
        doc.created_at = Instant.now().toString();
        doc.created_by_user_id = currentUser.userId();

        String rawSecret = null;
        if ("confidential".equals(doc.client_type)) {
            rawSecret = randomSecret();
            doc.client_secret_hash = passwordEncoder.encode(rawSecret);
        }

        documents.save(SpacecworpOauthCollections.CLIENTS, doc.id, doc);
        return toRegistrationResponse(doc, rawSecret);
    }

    public List<SpacecworpOauthDtos.ClientView> listClients(AuthUser currentUser) {
        ensureAdmin(currentUser);
        ensurePlatformClients();

        List<SpacecworpOauthDtos.ClientView> out = new ArrayList<>();
        findClientsByTenant(PLATFORM_TENANT).forEach(client -> out.add(toClientView(client)));
        findClientsByTenant(currentUser.tenantId()).forEach(client -> out.add(toClientView(client)));
        return out;
    }

    public SpacecworpOauthDtos.AuthorizeResponse authorize(SpacecworpOauthDtos.AuthorizeRequest request, String issuer) {
        ensurePlatformClients();
        if (!Boolean.TRUE.equals(request.oauth_consent())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Consentimento OAuth é obrigatório");
        }
        if (!"code".equals(request.response_type())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "response_type inválido");
        }
        if (!"S256".equalsIgnoreCase(request.code_challenge_method())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "code_challenge_method deve ser S256");
        }

        UserDocument user = documents.listByField(
                        FirestoreCollections.USERS,
                        "email",
                        request.email().trim().toLowerCase(),
                        UserDocument.class
                ).stream()
                .findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Credenciais inválidas"));

        if (!passwordEncoder.matches(request.password(), user.password)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Credenciais inválidas");
        }

        OAuthClientDocument client = getClientForTenant(request.client_id(), user.tenant_id);
        validateRedirectUri(client, request.redirect_uri());

        OAuthAuthorizationCodeDocument code = new OAuthAuthorizationCodeDocument();
        code.id = randomSecret();
        code.client_id = client.client_id;
        code.user_id = user.id;
        code.tenant_id = user.tenant_id;
        code.redirect_uri = request.redirect_uri().trim();
        code.code_challenge = request.code_challenge().trim();
        code.code_challenge_method = request.code_challenge_method().trim();
        code.scope = resolveGrantedScopes(client, user.role, request.scope());
        code.state = request.state().trim();
        code.created_at = Instant.now().toString();
        code.expires_at = Instant.now().plusSeconds(120).toString();
        documents.save(SpacecworpOauthCollections.AUTHORIZATION_CODES, code.id, code);

        return new SpacecworpOauthDtos.AuthorizeResponse(
                code.id,
                code.state,
                code.redirect_uri,
                issuer,
                client.client_id,
                SERVICE_NAME
        );
    }

    public SpacecworpOauthDtos.TokenResponse token(SpacecworpOauthDtos.TokenRequest request, String issuer) {
        ensurePlatformClients();
        return switch (request.grant_type()) {
            case "authorization_code" -> exchangeAuthorizationCode(request, issuer);
            case "refresh_token" -> refreshToken(request, issuer);
            default -> throw new ApiException(HttpStatus.BAD_REQUEST, "grant_type não suportado");
        };
    }

    public SpacecworpOauthDtos.IntrospectResponse introspect(SpacecworpOauthDtos.IntrospectRequest request) {
        ensurePlatformClients();
        try {
            Claims claims = jwtService.parseClaims(request.token());
            OAuthClientDocument client = getClientForIntrospection(request.client_id(), request.client_secret());
            String audience = extractAudience(claims);
            if (!Objects.equals(client.client_id, audience)) {
                return inactiveIntrospection();
            }
            if ("refresh".equals(claims.get("token_type", String.class))) {
                OAuthRefreshTokenDocument stored = documents.findById(
                                SpacecworpOauthCollections.REFRESH_TOKENS,
                                claims.getId(),
                                OAuthRefreshTokenDocument.class
                        )
                        .orElse(null);
                if (stored == null || stored.revoked) {
                    return inactiveIntrospection();
                }
            }
            @SuppressWarnings("unchecked")
            List<String> scope = claims.get("scope", List.class);
            return new SpacecworpOauthDtos.IntrospectResponse(
                    true,
                    scope == null ? "" : String.join(" ", scope),
                    client.client_id,
                    claims.get("email", String.class),
                    claims.get("token_type", String.class),
                    claims.getExpiration() == null ? 0 : claims.getExpiration().toInstant().getEpochSecond(),
                    claims.getIssuedAt() == null ? 0 : claims.getIssuedAt().toInstant().getEpochSecond(),
                    claims.getSubject(),
                    audience,
                    claims.getIssuer(),
                    claims.get("tenant_id", String.class),
                    SERVICE_NAME
            );
        } catch (JwtException | ApiException e) {
            return inactiveIntrospection();
        }
    }

    public void revoke(SpacecworpOauthDtos.RevokeRequest request) {
        ensurePlatformClients();
        getClientForIntrospection(request.client_id(), request.client_secret());
        try {
            Claims claims = jwtService.parseClaims(request.token());
            jwtService.revokeToken(request.token());
            if ("refresh".equals(claims.get("token_type", String.class))) {
                documents.findById(SpacecworpOauthCollections.REFRESH_TOKENS, claims.getId(), OAuthRefreshTokenDocument.class)
                        .ifPresent(stored -> {
                            stored.revoked = true;
                            stored.revoked_at = Instant.now().toString();
                            documents.save(SpacecworpOauthCollections.REFRESH_TOKENS, stored.id, stored);
                        });
            }
        } catch (JwtException ignored) {
            // compatível com RFC 7009: revogação de token inválido ainda retorna sucesso
        }
    }

    public SpacecworpOauthDtos.UserInfoResponse userinfo(AuthUser currentUser, String issuer) {
        return new SpacecworpOauthDtos.UserInfoResponse(
                currentUser.userId(),
                currentUser.tenantId(),
                currentUser.name(),
                currentUser.email(),
                currentUser.role(),
                currentUser.scope(),
                issuer,
                SERVICE_NAME,
                COMPANY_NAME,
                COMPANY_TAX_ID
        );
    }

    public SpacecworpOauthDtos.TokenResponse issueFirstPartyTokenSet(UserDocument user, boolean oauthConsent, String issuer) {
        ensurePlatformClients();
        OAuthClientDocument client = findClientByClientId(DASHBOARD_CLIENT_ID, user.tenant_id)
                .orElseThrow(() -> new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Cliente OAuth padrão não configurado"));
        return issueTokenSet(user, client, AuthScopeCatalog.forRole(user.role), oauthConsent, issuer);
    }

    private SpacecworpOauthDtos.TokenResponse exchangeAuthorizationCode(SpacecworpOauthDtos.TokenRequest request, String issuer) {
        if (request.code() == null || request.code().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "authorization code obrigatório");
        }
        if (request.code_verifier() == null || request.code_verifier().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "code_verifier obrigatório");
        }
        if (request.client_id() == null || request.client_id().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "client_id obrigatório");
        }

        OAuthAuthorizationCodeDocument code = documents.findById(
                        SpacecworpOauthCollections.AUTHORIZATION_CODES,
                        request.code(),
                        OAuthAuthorizationCodeDocument.class
                )
                .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "authorization code inválido"));

        OAuthClientDocument client = getClientForToken(request.client_id(), request.client_secret(), code.tenant_id);
        validateRedirectUri(client, request.redirect_uri());
        if (!Objects.equals(code.client_id, client.client_id)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "authorization code não pertence ao client_id");
        }
        if (Instant.parse(code.expires_at).isBefore(Instant.now())) {
            documents.delete(SpacecworpOauthCollections.AUTHORIZATION_CODES, code.id);
            throw new ApiException(HttpStatus.BAD_REQUEST, "authorization code expirado");
        }
        if (!pkceChallenge(request.code_verifier()).equals(code.code_challenge)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "code_verifier inválido");
        }

        UserDocument user = documents.findById(FirestoreCollections.USERS, code.user_id, UserDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Usuário não encontrado"));
        documents.delete(SpacecworpOauthCollections.AUTHORIZATION_CODES, code.id);
        return issueTokenSet(user, client, code.scope, true, issuer);
    }

    private SpacecworpOauthDtos.TokenResponse refreshToken(SpacecworpOauthDtos.TokenRequest request, String issuer) {
        if (request.refresh_token() == null || request.refresh_token().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "refresh_token obrigatório");
        }
        if (request.client_id() == null || request.client_id().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "client_id obrigatório");
        }

        Claims claims = jwtService.parseClaims(request.refresh_token());
        if (!"refresh".equals(claims.get("token_type", String.class))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "token informado não é refresh_token");
        }

        OAuthRefreshTokenDocument stored = documents.findById(
                        SpacecworpOauthCollections.REFRESH_TOKENS,
                        claims.getId(),
                        OAuthRefreshTokenDocument.class
                )
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "refresh_token inválido"));

        OAuthClientDocument client = getClientForToken(request.client_id(), request.client_secret(), stored.tenant_id);
        if (!Objects.equals(client.client_id, stored.client_id) || stored.revoked) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "refresh_token inválido");
        }

        stored.revoked = true;
        stored.revoked_at = Instant.now().toString();
        documents.save(SpacecworpOauthCollections.REFRESH_TOKENS, stored.id, stored);
        jwtService.revokeToken(request.refresh_token());

        UserDocument user = documents.findById(FirestoreCollections.USERS, stored.user_id, UserDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Usuário não encontrado"));
        return issueTokenSet(user, client, stored.scope, true, issuer);
    }

    private SpacecworpOauthDtos.TokenResponse issueTokenSet(
            UserDocument user,
            OAuthClientDocument client,
            List<String> scopes,
            boolean oauthConsent,
            String issuer
    ) {
        List<String> grantedScopes = sanitizeScopes(scopes, AuthScopeCatalog.forRole(user.role));
        Map<String, Object> baseClaims = new java.util.LinkedHashMap<>();
        baseClaims.put("tenant_id", user.tenant_id);
        baseClaims.put("name", user.name);
        baseClaims.put("email", user.email);
        baseClaims.put("role", user.role);
        baseClaims.put("scope", grantedScopes);
        baseClaims.put("oauth_service", SERVICE_NAME);
        baseClaims.put("oauth_aliases", ALIASES);
        baseClaims.put("company_name", COMPANY_NAME);
        baseClaims.put("company_tax_id", COMPANY_TAX_ID);
        baseClaims.put("oauth_consent", oauthConsent);
        baseClaims.put("ai_agent_enabled", client.ai_agent_enabled);

        String accessToken = jwtService.issueToken(
                user.id,
                ACCESS_TTL_SECONDS,
                baseClaims,
                issuer,
                client.client_id,
                "access"
        );
        String refreshToken = jwtService.issueToken(
                user.id,
                REFRESH_TTL_SECONDS,
                baseClaims,
                issuer,
                client.client_id,
                "refresh"
        );

        Claims refreshClaims = jwtService.parseClaims(refreshToken);
        OAuthRefreshTokenDocument refreshDoc = new OAuthRefreshTokenDocument();
        refreshDoc.id = refreshClaims.getId();
        refreshDoc.jti = refreshClaims.getId();
        refreshDoc.client_id = client.client_id;
        refreshDoc.user_id = user.id;
        refreshDoc.tenant_id = user.tenant_id;
        refreshDoc.scope = grantedScopes;
        refreshDoc.created_at = Instant.now().toString();
        refreshDoc.expires_at = refreshClaims.getExpiration().toInstant().toString();
        refreshDoc.revoked = false;
        documents.save(SpacecworpOauthCollections.REFRESH_TOKENS, refreshDoc.id, refreshDoc);

        return new SpacecworpOauthDtos.TokenResponse(
                accessToken,
                refreshToken,
                "Bearer",
                ACCESS_TTL_SECONDS,
                String.join(" ", grantedScopes),
                issuer,
                client.client_id,
                SERVICE_NAME,
                COMPANY_NAME,
                COMPANY_TAX_ID
        );
    }

    private OAuthClientDocument getClientForTenant(String clientId, String tenantId) {
        return findClientByClientId(clientId, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "client_id inválido"));
    }

    private OAuthClientDocument getClientForToken(String clientId, String clientSecret, String tenantId) {
        OAuthClientDocument client = getClientForTenant(clientId, tenantId);
        assertClientSecret(client, clientSecret);
        return client;
    }

    private OAuthClientDocument getClientForIntrospection(String clientId, String clientSecret) {
        OAuthClientDocument client = findClientByClientId(clientId, PLATFORM_TENANT)
                .or(() -> findClientByClientId(clientId, null))
                .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "client_id inválido"));
        assertClientSecret(client, clientSecret);
        return client;
    }

    private Optional<OAuthClientDocument> findClientByClientId(String clientId, String tenantId) {
        List<OAuthClientDocument> matches = documents.listByField(
                SpacecworpOauthCollections.CLIENTS,
                "client_id",
                clientId,
                OAuthClientDocument.class
        );
        return matches.stream()
                .filter(client -> tenantId == null || Objects.equals(client.tenant_id, tenantId) || Objects.equals(client.tenant_id, PLATFORM_TENANT))
                .sorted(java.util.Comparator.comparing(client -> Objects.equals(client.tenant_id, PLATFORM_TENANT)))
                .findFirst();
    }

    private List<OAuthClientDocument> findClientsByTenant(String tenantId) {
        return documents.listByField(SpacecworpOauthCollections.CLIENTS, "tenant_id", tenantId, OAuthClientDocument.class);
    }

    private void assertClientSecret(OAuthClientDocument client, String clientSecret) {
        if (!"confidential".equals(client.client_type)) {
            return;
        }
        if (clientSecret == null || clientSecret.isBlank() || client.client_secret_hash == null || !passwordEncoder.matches(clientSecret, client.client_secret_hash)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "client_secret inválido");
        }
    }

    private List<String> resolveGrantedScopes(OAuthClientDocument client, String role, String requestedScope) {
        List<String> userScopes = AuthScopeCatalog.forRole(role);
        List<String> requested = requestedScope == null || requestedScope.isBlank()
                ? client.allowed_scopes
                : List.of(requestedScope.trim().split("\\s+"));
        return sanitizeScopes(requested, intersection(client.allowed_scopes, userScopes));
    }

    private List<String> sanitizeRedirectUris(List<String> redirectUris) {
        List<String> out = new ArrayList<>();
        for (String value : redirectUris == null ? List.<String>of() : redirectUris) {
            String normalized = String.valueOf(value == null ? "" : value).trim();
            if (!normalized.isEmpty()) {
                out.add(normalized);
            }
        }
        if (out.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Informe ao menos um redirect_uri");
        }
        return out.stream().distinct().toList();
    }

    private List<String> sanitizeScopes(List<String> requestedScopes, List<String> allowedScopes) {
        List<String> out = new ArrayList<>();
        for (String value : requestedScopes == null ? List.<String>of() : requestedScopes) {
            String normalized = String.valueOf(value == null ? "" : value).trim();
            if (!normalized.isEmpty() && allowedScopes.contains(normalized) && !out.contains(normalized)) {
                out.add(normalized);
            }
        }
        if (out.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Nenhum scope válido foi concedido");
        }
        return out;
    }

    private List<String> intersection(List<String> first, List<String> second) {
        return first.stream().filter(second::contains).distinct().toList();
    }

    private void validateRedirectUri(OAuthClientDocument client, String redirectUri) {
        if (redirectUri == null || redirectUri.isBlank() || !client.redirect_uris.contains(redirectUri.trim())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "redirect_uri inválido");
        }
    }

    private String normalizeClientType(String value) {
        String normalized = String.valueOf(value == null ? "" : value).trim().toLowerCase();
        if (!List.of("public", "confidential").contains(normalized)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "client_type deve ser public ou confidential");
        }
        return normalized;
    }

    private void ensureAdmin(AuthUser user) {
        if (!"admin".equalsIgnoreCase(user.role())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Apenas administradores podem gerenciar clientes OAuth");
        }
    }

    private String blankToNull(String value) {
        String normalized = value == null ? null : value.trim();
        return normalized == null || normalized.isEmpty() ? null : normalized;
    }

    private String randomSecret() {
        byte[] random = new byte[32];
        SECURE_RANDOM.nextBytes(random);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(random);
    }

    private String pkceChallenge(String verifier) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(verifier.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(hashed);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 indisponível", e);
        }
    }

    private String extractAudience(Claims claims) {
        if (claims.getAudience() != null && !claims.getAudience().isEmpty()) {
            return claims.getAudience().iterator().next();
        }
        Object aud = claims.get("aud");
        return aud == null ? null : String.valueOf(aud);
    }

    private SpacecworpOauthDtos.ClientRegistrationResponse toRegistrationResponse(OAuthClientDocument doc, String rawSecret) {
        return new SpacecworpOauthDtos.ClientRegistrationResponse(
                doc.id,
                doc.tenant_id,
                doc.name,
                doc.client_id,
                doc.client_type,
                rawSecret,
                doc.redirect_uris,
                doc.allowed_scopes,
                doc.first_party,
                doc.ai_agent_enabled,
                doc.created_at
        );
    }

    private SpacecworpOauthDtos.ClientView toClientView(OAuthClientDocument doc) {
        return new SpacecworpOauthDtos.ClientView(
                doc.id,
                doc.tenant_id,
                doc.name,
                doc.client_id,
                doc.client_type,
                doc.redirect_uris,
                doc.allowed_scopes,
                doc.first_party,
                doc.ai_agent_enabled,
                doc.description,
                doc.application_url,
                doc.created_at
        );
    }

    private SpacecworpOauthDtos.IntrospectResponse inactiveIntrospection() {
        return new SpacecworpOauthDtos.IntrospectResponse(false, "", null, null, null, 0, 0, null, null, null, null, SERVICE_NAME);
    }

    private void ensurePlatformClients() {
        if (findClientByClientId(DASHBOARD_CLIENT_ID, PLATFORM_TENANT).isEmpty()) {
            OAuthClientDocument dashboard = new OAuthClientDocument();
            dashboard.id = documents.nextId(SpacecworpOauthCollections.CLIENTS);
            dashboard.tenant_id = PLATFORM_TENANT;
            dashboard.name = SERVICE_NAME + " Dashboard";
            dashboard.client_id = DASHBOARD_CLIENT_ID;
            dashboard.client_type = "public";
            dashboard.redirect_uris = List.of("dashboard.html", "/dashboard.html", "http://localhost:8080/dashboard.html");
            dashboard.allowed_scopes = AuthScopeCatalog.forRole("admin");
            dashboard.first_party = true;
            dashboard.ai_agent_enabled = false;
            dashboard.description = "Cliente oficial do painel Spacecworp Despesas Pessoais.";
            dashboard.application_url = "/dashboard.html";
            dashboard.created_at = Instant.now().toString();
            dashboard.created_by_user_id = "system";
            documents.save(SpacecworpOauthCollections.CLIENTS, dashboard.id, dashboard);
        }
        if (findClientByClientId(AGENT_IA_CLIENT_ID, PLATFORM_TENANT).isEmpty()) {
            OAuthClientDocument agent = new OAuthClientDocument();
            agent.id = documents.nextId(SpacecworpOauthCollections.CLIENTS);
            agent.tenant_id = PLATFORM_TENANT;
            agent.name = SERVICE_NAME + " AgentIA";
            agent.client_id = AGENT_IA_CLIENT_ID;
            agent.client_type = "public";
            agent.redirect_uris = List.of("urn:ietf:wg:oauth:2.0:oob", "https://agent.spacecworp.app/callback");
            agent.allowed_scopes = List.of("profile:read", "reports:read", "payments:read", "marketplace:ai_agent");
            agent.first_party = true;
            agent.ai_agent_enabled = true;
            agent.description = "Cliente padrão para integrações com AgentIA.";
            agent.application_url = "https://agent.spacecworp.app";
            agent.created_at = Instant.now().toString();
            agent.created_by_user_id = "system";
            documents.save(SpacecworpOauthCollections.CLIENTS, agent.id, agent);
        }
    }
}
