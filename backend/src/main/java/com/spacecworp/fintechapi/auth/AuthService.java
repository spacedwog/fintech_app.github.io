package com.spacecworp.fintechapi.auth;

import com.spacecworp.fintechapi.common.ApiException;
import com.spacecworp.fintechapi.expenses.CategoryDocument;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.notifications.RegistrationEmailQueue;
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
    private final FirestoreGateway firestore;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final PlanController planController;
    private final RegistrationEmailQueue registrationEmailQueue;

    public AuthService(
            FirestoreGateway firestore,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            PlanController planController,
            RegistrationEmailQueue registrationEmailQueue
    ) {
        this.firestore = firestore;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.planController = planController;
        this.registrationEmailQueue = registrationEmailQueue;
    }

    public AuthDtos.AuthResponse signup(AuthDtos.SignupRequest req) {
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

        registrationEmailQueue.enqueue(user, tenant);
        return toAuthResponse(user);
    }

    public AuthDtos.AuthResponse login(AuthDtos.LoginRequest req) {
        if (Boolean.FALSE.equals(req.oauth_consent())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Consentimento OAuth é obrigatório");
        }
        List<UserDocument> users = firestore.listByField(FirestoreCollections.USERS, "email", req.email().toLowerCase(), UserDocument.class);
        if (users.isEmpty()) throw new ApiException(HttpStatus.UNAUTHORIZED, "Credenciais inválidas");
        UserDocument user = users.get(0);
        if (!passwordEncoder.matches(req.password(), user.password)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Credenciais inválidas");
        }
        return toAuthResponse(user);
    }

    public AuthDtos.AuthResponse refresh(AuthDtos.RefreshRequest request) {
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
        return toAuthResponse(user);
    }

    public AuthDtos.MeResponse me(AuthUser session) {
        UserDocument user = firestore.findById(FirestoreCollections.USERS, session.userId(), UserDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Usuário não encontrado"));
        TenantDocument tenant = firestore.findById(FirestoreCollections.TENANTS, session.tenantId(), TenantDocument.class)
                .orElse(new TenantDocument(session.tenantId(), "Conta", null));
        PlanSubscriptionDocument sub = planController.currentSubscription(session.tenantId());
        AuthDtos.UserPayload userPayload = new AuthDtos.UserPayload(user.id, user.tenant_id, user.name, user.email, user.role, user.tax_document, buildScopes(user.role));
        AuthDtos.TenantPayload tenantPayload = new AuthDtos.TenantPayload(tenant.id, tenant.name, sub.plan);
        return new AuthDtos.MeResponse(userPayload, tenantPayload);
    }

    private AuthDtos.AuthResponse toAuthResponse(UserDocument user) {
        List<String> scopes = buildScopes(user.role);
        String accessToken = jwtService.issue(new AuthUser(user.id, user.tenant_id, user.name, user.email, user.role, scopes));
        String scopesJson = scopes.stream().map(s -> "\"" + escape(s) + "\"").collect(java.util.stream.Collectors.joining(","));
        String legacySessionToken = "{" +
                "\"legacy\":true," +
                "\"user_id\":\"" + user.id + "\"," +
                "\"tenant_id\":\"" + user.tenant_id + "\"," +
                "\"name\":\"" + escape(user.name) + "\"," +
                "\"email\":\"" + user.email + "\"," +
                "\"role\":\"" + user.role + "\"," +
                "\"scope\":[" + scopesJson + "]," +
                "\"access_token\":\"" + accessToken + "\"," +
                "\"refresh_token\":\"" + accessToken + "\"," +
                "\"token_type\":\"Bearer\"," +
                "\"expires_in\":3600" +
                "}";

        AuthDtos.UserPayload payload = new AuthDtos.UserPayload(user.id, user.tenant_id, user.name, user.email, user.role, user.tax_document, scopes);
        return new AuthDtos.AuthResponse(legacySessionToken, payload);
    }

    private String escape(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private List<String> buildScopes(String role) {
        List<String> base = List.of(
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
                "invoices:read"
        );
        if ("admin".equalsIgnoreCase(role)) {
            return java.util.stream.Stream.concat(base.stream(), java.util.stream.Stream.of("plans:write", "team:write"))
                    .distinct()
                    .toList();
        }
        return base;
    }
}
