package com.spacecworp.fintechapi.auth;

import com.spacecworp.fintechapi.common.ApiException;
import com.spacecworp.fintechapi.expenses.CategoryDocument;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.plans.PlanSubscriptionDocument;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.JwtService;
import com.spacecworp.fintechapi.users.UserDocument;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

@Service
public class AuthService {
    private final FirestoreGateway firestore;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(FirestoreGateway firestore, PasswordEncoder passwordEncoder, JwtService jwtService) {
        this.firestore = firestore;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    public AuthDtos.AuthResponse signup(AuthDtos.SignupRequest req) {
        if (!firestore.listByField(FirestoreCollections.USERS, "email", req.email().toLowerCase(), UserDocument.class).isEmpty()) {
            throw new ApiException(HttpStatus.CONFLICT, "E-mail já cadastrado");
        }

        String now = Instant.now().toString();
        String tenantId = firestore.nextId(FirestoreCollections.TENANTS);
        String userId = firestore.nextId(FirestoreCollections.USERS);

        firestore.save(FirestoreCollections.TENANTS, tenantId, new TenantDocument(tenantId, req.company_name(), now));

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

        return toAuthResponse(user);
    }

    public AuthDtos.AuthResponse login(AuthDtos.LoginRequest req) {
        List<UserDocument> users = firestore.listByField(FirestoreCollections.USERS, "email", req.email().toLowerCase(), UserDocument.class);
        if (users.isEmpty()) throw new ApiException(HttpStatus.UNAUTHORIZED, "Credenciais inválidas");
        UserDocument user = users.getFirst();
        if (!passwordEncoder.matches(req.password(), user.password)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Credenciais inválidas");
        }
        return toAuthResponse(user);
    }

    private AuthDtos.AuthResponse toAuthResponse(UserDocument user) {
        List<String> scopes = List.of("expenses:read", "expenses:write", "plans:read", "payments:write");
        String accessToken = jwtService.issue(new AuthUser(user.id, user.tenant_id, user.name, user.email, user.role, scopes));
        String legacySessionToken = "{" +
                "\"legacy\":true," +
                "\"user_id\":\"" + user.id + "\"," +
                "\"tenant_id\":\"" + user.tenant_id + "\"," +
                "\"name\":\"" + escape(user.name) + "\"," +
                "\"email\":\"" + user.email + "\"," +
                "\"role\":\"" + user.role + "\"," +
                "\"scope\":[\"expenses:read\",\"expenses:write\",\"plans:read\",\"payments:write\"]," +
                "\"access_token\":\"" + accessToken + "\"," +
                "\"refresh_token\":\"" + accessToken + "\"," +
                "\"token_type\":\"Bearer\"," +
                "\"expires_in\":3600" +
                "}";

        AuthDtos.UserPayload payload = new AuthDtos.UserPayload(user.id, user.tenant_id, user.name, user.email, user.role);
        return new AuthDtos.AuthResponse(legacySessionToken, payload);
    }

    private String escape(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
