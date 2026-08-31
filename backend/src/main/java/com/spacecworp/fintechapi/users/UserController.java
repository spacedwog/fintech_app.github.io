package com.spacecworp.fintechapi.users;

import com.spacecworp.fintechapi.common.ApiException;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.SecurityUtils;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;

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

    public record UserResponse(String id, String tenant_id, String name, String email, String role) {}

    @GetMapping
    public List<UserResponse> listUsers() {
        AuthUser user = SecurityUtils.currentUser();
        return firestore.listByField(FirestoreCollections.USERS, "tenant_id", user.tenantId(), UserDocument.class).stream()
                .map(u -> new UserResponse(u.id, u.tenant_id, u.name, u.email, u.role))
                .toList();
    }

    public record InviteUserRequest(@NotBlank String name, @NotBlank @Email String email, @NotBlank String password, @NotBlank String role) {}

    @PostMapping("/invite")
    public UserResponse inviteUser(@RequestBody InviteUserRequest req) {
        AuthUser actor = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(actor);

        String normalized = req.email().toLowerCase();
        boolean exists = !firestore.listByField(FirestoreCollections.USERS, "email", normalized, UserDocument.class).isEmpty();
        if (exists) throw new ApiException(HttpStatus.CONFLICT, "E-mail já cadastrado");

        String role = req.role().equalsIgnoreCase("admin") ? "admin" : "member";
        String id = firestore.nextId(FirestoreCollections.USERS);
        UserDocument doc = new UserDocument(id, actor.tenantId(), req.name(), normalized, passwordEncoder.encode(req.password()), role, Instant.now().toString());
        firestore.save(FirestoreCollections.USERS, id, doc);
        return new UserResponse(doc.id, doc.tenant_id, doc.name, doc.email, doc.role);
    }
}
