package com.spacecworp.fintechapi.users;

import com.spacecworp.fintechapi.common.ApiException;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.SecurityUtils;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/users")
@Validated
public class UserController {
    private final FirestoreGateway firestore;
    private final PasswordEncoder passwordEncoder;

    public UserController(FirestoreGateway firestore, PasswordEncoder passwordEncoder) {
        this.firestore = firestore;
        this.passwordEncoder = passwordEncoder;
    }

    public record UserResponse(String id, String tenant_id, String name, String email, String role, String tax_document) {}
    public record InviteUserRequest(@NotBlank String name, @NotBlank @Email String email, @NotBlank String password, @NotBlank String role) {}
    public record UpdateProfileRequest(@NotBlank String name, String document) {}
    public record UpdateRoleRequest(@NotBlank String role) {}
    public record ChangePasswordRequest(@NotBlank String currentPassword, @NotBlank String newPassword) {}

    @GetMapping
    public List<UserResponse> listUsers() {
        AuthUser user = SecurityUtils.currentUser();
        return firestore.listByField(FirestoreCollections.USERS, "tenant_id", user.tenantId(), UserDocument.class).stream()
                .map(u -> new UserResponse(u.id, u.tenant_id, u.name, u.email, u.role, u.tax_document))
                .toList();
    }

    @GetMapping("/me")
    public UserResponse me() {
        AuthUser session = SecurityUtils.currentUser();
        UserDocument user = firestore.findById(FirestoreCollections.USERS, session.userId(), UserDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Usuário não encontrado"));
        return new UserResponse(user.id, user.tenant_id, user.name, user.email, user.role, user.tax_document);
    }

    @PutMapping("/me")
    public UserResponse updateProfile(@Valid @RequestBody UpdateProfileRequest req) {
        AuthUser session = SecurityUtils.currentUser();
        UserDocument user = firestore.findById(FirestoreCollections.USERS, session.userId(), UserDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Usuário não encontrado"));
        user.name = req.name().trim();
        user.tax_document = req.document() == null || req.document().isBlank() ? null : req.document().trim();
        firestore.save(FirestoreCollections.USERS, user.id, user);
        return new UserResponse(user.id, user.tenant_id, user.name, user.email, user.role, user.tax_document);
    }

    @PostMapping("/invite")
    public UserResponse inviteUser(@Valid @RequestBody InviteUserRequest req) {
        AuthUser actor = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(actor);

        String normalized = req.email().toLowerCase();
        boolean exists = !firestore.listByField(FirestoreCollections.USERS, "email", normalized, UserDocument.class).isEmpty();
        if (exists) throw new ApiException(HttpStatus.CONFLICT, "E-mail já cadastrado");

        String role = req.role().equalsIgnoreCase("admin") ? "admin" : "member";
        String id = firestore.nextId(FirestoreCollections.USERS);
        UserDocument doc = new UserDocument(id, actor.tenantId(), req.name(), normalized, passwordEncoder.encode(req.password()), role, Instant.now().toString());
        firestore.save(FirestoreCollections.USERS, id, doc);
        return new UserResponse(doc.id, doc.tenant_id, doc.name, doc.email, doc.role, doc.tax_document);
    }

    @PatchMapping("/{id}/role")
    public UserResponse updateRole(@PathVariable String id, @Valid @RequestBody UpdateRoleRequest req) {
        AuthUser actor = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(actor);
        UserDocument target = firestore.findById(FirestoreCollections.USERS, id, UserDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Usuário não encontrado"));
        if (!actor.tenantId().equals(target.tenant_id)) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        String role = req.role().equalsIgnoreCase("admin") ? "admin" : "member";
        target.role = role;
        firestore.save(FirestoreCollections.USERS, target.id, target);
        return new UserResponse(target.id, target.tenant_id, target.name, target.email, target.role, target.tax_document);
    }

    @PostMapping("/{id}/reset-password")
    public Map<String, Object> resetPassword(@PathVariable String id, @RequestBody Map<String, String> body) {
        AuthUser actor = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(actor);
        String newPassword = body.getOrDefault("new_password", "").trim();
        if (newPassword.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "new_password é obrigatório");
        UserDocument target = firestore.findById(FirestoreCollections.USERS, id, UserDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Usuário não encontrado"));
        if (!actor.tenantId().equals(target.tenant_id)) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        target.password = passwordEncoder.encode(newPassword);
        firestore.save(FirestoreCollections.USERS, target.id, target);
        return Map.of("ok", true);
    }

    @PostMapping("/me/change-password")
    public Map<String, Object> changeMyPassword(@Valid @RequestBody ChangePasswordRequest req) {
        AuthUser session = SecurityUtils.currentUser();
        UserDocument user = firestore.findById(FirestoreCollections.USERS, session.userId(), UserDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Usuário não encontrado"));
        if (!passwordEncoder.matches(req.currentPassword(), user.password)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Senha atual incorreta");
        }
        user.password = passwordEncoder.encode(req.newPassword());
        firestore.save(FirestoreCollections.USERS, user.id, user);
        return Map.of("ok", true);
    }
}
