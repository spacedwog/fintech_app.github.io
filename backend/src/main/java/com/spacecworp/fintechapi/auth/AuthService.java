package com.spacecworp.fintechapi.auth;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spacecworp.fintechapi.common.ApiException;
import com.spacecworp.fintechapi.expenses.CategoryDocument;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.DocumentGateway;
import com.spacecworp.fintechapi.oauth.SpacecworpOauthDtos;
import com.spacecworp.fintechapi.oauth.SpacecworpOauthService;
import com.spacecworp.fintechapi.plans.PlanController;
import com.spacecworp.fintechapi.plans.PlanSubscriptionDocument;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.JwtService;
import com.spacecworp.fintechapi.users.UserDocument;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

@Service
public class AuthService {
    private final DocumentGateway firestore;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final PlanController planController;
    private final SpacecworpOauthService spacecworpOauthService;
    private final ObjectMapper objectMapper;

    public AuthService(
            DocumentGateway firestore,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            PlanController planController,
            SpacecworpOauthService spacecworpOauthService,
            ObjectMapper objectMapper
    ) {
        this.firestore = firestore;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.planController = planController;
        this.spacecworpOauthService = spacecworpOauthService;
        this.objectMapper = objectMapper;
    }

    public AuthDtos.AuthResponse signup(AuthDtos.SignupRequest req, String issuer) {
        if (!firestore.listByField(FirestoreCollections.USERS, "email", req.email().toLowerCase(), UserDocument.class).isEmpty()) {
            throw new ApiException(HttpStatus.CONFLICT, "E-mail já cadastrado");
        }

        String now = Instant.now().toString();
        String tenantId = firestore.nextId(FirestoreCollections.TENANTS);
        String userId = firestore.nextId(FirestoreCollections.USERS);

        TenantDocument tenant = new TenantDocument(tenantId, req.company_name(), now);
        firestore.save(FirestoreCollections.TENANTS, tenantId, tenant);

        UserDocument user = new UserDocument(
                userId,
                tenantId,
                req.admin_name(),
                req.email().toLowerCase(),
                passwordEncoder.encode(req.password()),
                "admin",
                now
        );
        firestore.save(FirestoreCollections.USERS, userId, user);

        String planId = firestore.nextId(FirestoreCollections.PLANS);
        firestore.save(FirestoreCollections.PLANS, planId, new PlanSubscriptionDocument(planId, tenantId, "free", now));

        List<String> defaults = List.of("Mercado", "Moradia", "Transporte", "Saúde", "Lazer");
        for (String categoryName : defaults) {
            String categoryId = firestore.nextId(FirestoreCollections.CATEGORIES);
            firestore.save(FirestoreCollections.CATEGORIES, categoryId, new CategoryDocument(categoryId, tenantId, categoryName));
        }
        return toAuthResponse(user, issuer);
    }

    public AuthDtos.AuthResponse login(AuthDtos.LoginRequest req, String issuer) {
        if (Boolean.FALSE.equals(req.oauth_consent())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Consentimento OAuth é obrigatório");
        }
        List<UserDocument> users = firestore.listByField(FirestoreCollections.USERS, "email", req.email().toLowerCase(), UserDocument.class);
        if (users.isEmpty()) throw new ApiException(HttpStatus.UNAUTHORIZED, "Credenciais inválidas");
        UserDocument user = users.get(0);
        if (!passwordEncoder.matches(req.password(), user.password)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Credenciais inválidas");
        }
        return toAuthResponse(user, issuer);
    }

    public AuthDtos.AuthResponse refresh(AuthDtos.RefreshRequest request, String issuer) {
        AuthUser claims;
        try {
            claims = jwtService.parse(request.access_token());
        } catch (Exception e) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Token inválido ou expirado");
        }
        UserDocument user = firestore.findById(FirestoreCollections.USERS, claims.userId(), UserDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Usuário não encontrado"));
        if (!user.tenant_id.equals(claims.tenantId())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Sessão inválida");
        }
        return toAuthResponse(user, issuer);
    }

    public AuthDtos.MeResponse me(AuthUser session) {
        UserDocument user = firestore.findById(FirestoreCollections.USERS, session.userId(), UserDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Usuário não encontrado"));
        TenantDocument tenant = firestore.findById(FirestoreCollections.TENANTS, session.tenantId(), TenantDocument.class)
                .orElse(new TenantDocument(session.tenantId(), "Conta", null));
        PlanSubscriptionDocument sub = planController.currentSubscription(session.tenantId());
        AuthDtos.UserPayload userPayload = new AuthDtos.UserPayload(user.id, user.tenant_id, user.name, user.email, user.role, user.tax_document, AuthScopeCatalog.forRole(user.role));
        AuthDtos.TenantPayload tenantPayload = new AuthDtos.TenantPayload(tenant.id, tenant.name, sub.plan);
        return new AuthDtos.MeResponse(userPayload, tenantPayload);
    }

    private AuthDtos.AuthResponse toAuthResponse(UserDocument user, String issuer) {
        List<String> scopes = AuthScopeCatalog.forRole(user.role);
        SpacecworpOauthDtos.TokenResponse tokenSet = spacecworpOauthService.issueFirstPartyTokenSet(user, true, issuer);
        String sessionToken = toLegacySessionJson(user, scopes, tokenSet);
        AuthDtos.UserPayload payload = new AuthDtos.UserPayload(user.id, user.tenant_id, user.name, user.email, user.role, user.tax_document, scopes);
        return new AuthDtos.AuthResponse(sessionToken, payload);
    }

    private String toLegacySessionJson(UserDocument user, List<String> scopes, SpacecworpOauthDtos.TokenResponse tokenSet) {
        try {
            java.util.Map<String, Object> payload = new java.util.LinkedHashMap<>();
            payload.put("legacy", true);
            payload.put("user_id", user.id);
            payload.put("tenant_id", user.tenant_id);
            payload.put("name", user.name);
            payload.put("email", user.email);
            payload.put("role", user.role);
            payload.put("scope", scopes);
            payload.put("access_token", tokenSet.access_token());
            payload.put("refresh_token", tokenSet.refresh_token());
            payload.put("token_type", tokenSet.token_type());
            payload.put("expires_in", tokenSet.expires_in());
            payload.put("service_name", tokenSet.service_name());
            payload.put("company_name", tokenSet.company_name());
            payload.put("company_tax_id", tokenSet.company_tax_id());
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Falha ao montar sessão OAuth");
        }
    }
}
