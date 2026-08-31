package com.spacecworp.fintechapi.plans;

import com.spacecworp.fintechapi.common.ApiException;
import com.spacecworp.fintechapi.expenses.ExpenseDocument;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.governance.AuditService;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.SecurityUtils;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/plans")
public class PlanController {
    private final FirestoreGateway firestore;
    private final AuditService auditService;

    public PlanController(FirestoreGateway firestore, AuditService auditService) {
        this.firestore = firestore;
        this.auditService = auditService;
    }

    public record ChangePlanRequest(@NotBlank String plan) {}
    public record OveragePreviewRequest(@NotBlank String type, @Min(1) int units) {}

    @GetMapping
    public Map<String, Object> plans() {
        AuthUser user = SecurityUtils.currentUser();
        PlanSubscriptionDocument current = currentSubscription(user.tenantId());
        PlanCatalog.PlanDto currentPlan = PlanCatalog.find(current.plan);
        return Map.of("plans", PlanCatalog.ALL, "current_plan", current.plan, "limits", currentPlan);
    }

    @GetMapping("/active")
    public Map<String, Object> activePlan() {
        AuthUser user = SecurityUtils.currentUser();
        PlanSubscriptionDocument current = currentSubscription(user.tenantId());
        PlanCatalog.PlanDto plan = PlanCatalog.find(current.plan);
        int usedToday = (int) firestore.listByField(FirestoreCollections.EXPENSES, "tenant_id", user.tenantId(), ExpenseDocument.class).stream()
                .filter(e -> user.userId().equals(e.user_id))
                .filter(e -> LocalDate.now().toString().equals(e.date))
                .count();
        int remaining = plan.daily_expense_limit() == Integer.MAX_VALUE ? Integer.MAX_VALUE : Math.max(0, plan.daily_expense_limit() - usedToday);
        return Map.of(
                "plan", plan,
                "used_today", usedToday,
                "remaining_today", remaining,
                "over_quota", plan.daily_expense_limit() != Integer.MAX_VALUE && usedToday >= plan.daily_expense_limit()
        );
    }

    @PostMapping("/change")
    public Map<String, Object> change(@Valid @RequestBody ChangePlanRequest req) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(user);
        if (PlanCatalog.find(req.plan()) == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Plano inválido");
        }
        List<PlanSubscriptionDocument> rows = firestore.listByField(FirestoreCollections.PLANS, "tenant_id", user.tenantId(), PlanSubscriptionDocument.class);
        PlanSubscriptionDocument current = rows.isEmpty()
                ? new PlanSubscriptionDocument(firestore.nextId(FirestoreCollections.PLANS), user.tenantId(), req.plan(), Instant.now().toString())
                : rows.get(0);
        String previousPlan = current.plan;
        current.plan = req.plan().toLowerCase();
        current.updated_at = Instant.now().toString();
        firestore.save(FirestoreCollections.PLANS, current.id, current);
        auditService.record(
                user,
                "plan.changed",
                "tenant_plan",
                current.id,
                "Plano alterado",
                Map.of("previous_plan", previousPlan == null ? "" : previousPlan, "new_plan", current.plan)
        );
        return Map.of("ok", true, "plan", current.plan);
    }

    @PostMapping("/overage/preview")
    public Map<String, Object> previewOverage(@Valid @RequestBody OveragePreviewRequest req) {
        AuthUser user = SecurityUtils.currentUser();
        PlanCatalog.PlanDto plan = PlanCatalog.find(currentSubscription(user.tenantId()).plan);
        double unitPrice;
        if ("expense".equalsIgnoreCase(req.type())) {
            unitPrice = plan.overage_price();
        } else if ("budget_import".equalsIgnoreCase(req.type())) {
            unitPrice = "free".equals(plan.code()) ? 10.0 : 0.0;
        } else {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Tipo de excedente inválido");
        }
        return Map.of(
                "type", req.type().toLowerCase(),
                "units", req.units(),
                "unit_price", unitPrice,
                "total", unitPrice * req.units(),
                "currency", "BRL"
        );
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
