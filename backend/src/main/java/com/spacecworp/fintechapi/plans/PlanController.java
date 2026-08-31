package com.spacecworp.fintechapi.plans;

import com.spacecworp.fintechapi.common.ApiException;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.SecurityUtils;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/plans")
public class PlanController {
    private final FirestoreGateway firestore;

    public PlanController(FirestoreGateway firestore) {
        this.firestore = firestore;
    }

    @GetMapping
    public Map<String, Object> plans() {
        AuthUser user = SecurityUtils.currentUser();
        PlanSubscriptionDocument current = currentSubscription(user.tenantId());
        return Map.of("plans", PlanCatalog.ALL, "current_plan", current.plan);
    }

    public record ChangePlanRequest(@NotBlank String plan) {}

    @PostMapping("/change")
    public Map<String, Object> change(@RequestBody ChangePlanRequest req) {
        AuthUser user = SecurityUtils.currentUser();
        if (PlanCatalog.find(req.plan()) == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Plano inválido");
        }
        List<PlanSubscriptionDocument> rows = firestore.listByField(FirestoreCollections.PLANS, "tenant_id", user.tenantId(), PlanSubscriptionDocument.class);
        PlanSubscriptionDocument current = rows.isEmpty()
                ? new PlanSubscriptionDocument(firestore.nextId(FirestoreCollections.PLANS), user.tenantId(), req.plan(), Instant.now().toString())
                : rows.get(0);
        current.plan = req.plan().toLowerCase();
        current.updated_at = Instant.now().toString();
        firestore.save(FirestoreCollections.PLANS, current.id, current);
        return Map.of("ok", true, "plan", current.plan);
    }

    public PlanSubscriptionDocument currentSubscription(String tenantId) {
        List<PlanSubscriptionDocument> rows = firestore.listByField(FirestoreCollections.PLANS, "tenant_id", tenantId, PlanSubscriptionDocument.class);
        if (rows.isEmpty()) {
            PlanSubscriptionDocument seeded = new PlanSubscriptionDocument(firestore.nextId(FirestoreCollections.PLANS), tenantId, "free", Instant.now().toString());
            firestore.save(FirestoreCollections.PLANS, seeded.id, seeded);
            return seeded;
        }
        return rows.get(0);
    }
}
