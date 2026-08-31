package com.spacecworp.fintechapi.expenses;

import com.spacecworp.fintechapi.common.ApiException;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.plans.PlanCatalog;
import com.spacecworp.fintechapi.plans.PlanController;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.SecurityUtils;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
@Validated
public class ExpenseController {
    private final FirestoreGateway firestore;
    private final PlanController planController;

    public ExpenseController(FirestoreGateway firestore, PlanController planController) {
        this.firestore = firestore;
        this.planController = planController;
    }

    public record CategoryRequest(@NotBlank String name) {}

    @GetMapping("/categories")
    public List<CategoryDocument> listCategories() {
        AuthUser user = SecurityUtils.currentUser();
        return firestore.listByField(FirestoreCollections.CATEGORIES, "tenant_id", user.tenantId(), CategoryDocument.class);
    }

    @PostMapping("/categories")
    public CategoryDocument addCategory(@RequestBody CategoryRequest req) {
        AuthUser user = SecurityUtils.currentUser();
        String id = firestore.nextId(FirestoreCollections.CATEGORIES);
        CategoryDocument doc = new CategoryDocument(id, user.tenantId(), req.name().trim());
        firestore.save(FirestoreCollections.CATEGORIES, id, doc);
        return doc;
    }

    public record ExpenseRequest(
            @DecimalMin(value = "0.01") double amount,
            @NotBlank String date,
            @NotBlank String description,
            String category_id,
            String transaction_number
    ) {}

    @GetMapping("/expenses")
    public List<ExpenseDocument> listExpenses(@RequestParam(defaultValue = "false") boolean allUsers) {
        AuthUser user = SecurityUtils.currentUser();
        List<ExpenseDocument> tenantExpenses = firestore.listByField(FirestoreCollections.EXPENSES, "tenant_id", user.tenantId(), ExpenseDocument.class);
        if (allUsers) return tenantExpenses;
        return tenantExpenses.stream().filter(e -> user.userId().equals(e.user_id)).toList();
    }

    @GetMapping("/expenses/quota")
    public Map<String, Object> quota() {
        AuthUser user = SecurityUtils.currentUser();
        PlanCatalog.PlanDto plan = PlanCatalog.find(planController.currentSubscription(user.tenantId()).plan);
        int usedToday = (int) firestore.listByField(FirestoreCollections.EXPENSES, "tenant_id", user.tenantId(), ExpenseDocument.class).stream()
                .filter(e -> user.userId().equals(e.user_id))
                .filter(e -> LocalDate.now().toString().equals(e.date))
                .count();
        int limit = plan.daily_expense_limit();
        int remaining = limit == Integer.MAX_VALUE ? Integer.MAX_VALUE : Math.max(0, limit - usedToday);
        return Map.of(
                "plan", plan.code(),
                "daily_limit", limit,
                "used_today", usedToday,
                "remaining_today", remaining,
                "over_quota", limit != Integer.MAX_VALUE && usedToday >= limit,
                "overage_price", plan.overage_price()
        );
    }

    @PostMapping("/expenses")
    public ExpenseDocument addExpense(@RequestBody ExpenseRequest req) {
        AuthUser user = SecurityUtils.currentUser();
        Map<String, Object> quota = quota();
        if (Boolean.TRUE.equals(quota.get("over_quota"))) {
            throw new ApiException(HttpStatus.PAYMENT_REQUIRED, "Limite diário excedido para o plano atual");
        }
        String id = firestore.nextId(FirestoreCollections.EXPENSES);
        ExpenseDocument doc = new ExpenseDocument();
        doc.id = id;
        doc.tenant_id = user.tenantId();
        doc.user_id = user.userId();
        doc.amount = req.amount();
        doc.date = req.date();
        doc.description = req.description();
        doc.category_id = req.category_id();
        doc.transaction_number = req.transaction_number();
        doc.generated_by_mercado_pago = false;
        firestore.save(FirestoreCollections.EXPENSES, id, doc);
        return doc;
    }

    @PutMapping("/expenses/{id}")
    public ExpenseDocument updateExpense(@PathVariable String id, @RequestBody ExpenseRequest req) {
        AuthUser user = SecurityUtils.currentUser();
        ExpenseDocument current = firestore.findById(FirestoreCollections.EXPENSES, id, ExpenseDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Despesa não encontrada"));
        if (!user.tenantId().equals(current.tenant_id)) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        current.amount = req.amount();
        current.date = req.date();
        current.description = req.description();
        current.category_id = req.category_id();
        current.transaction_number = req.transaction_number();
        firestore.save(FirestoreCollections.EXPENSES, id, current);
        return current;
    }

    @DeleteMapping("/expenses/{id}")
    public Map<String, Object> deleteExpense(@PathVariable String id) {
        AuthUser user = SecurityUtils.currentUser();
        ExpenseDocument current = firestore.findById(FirestoreCollections.EXPENSES, id, ExpenseDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Despesa não encontrada"));
        if (!user.tenantId().equals(current.tenant_id)) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        firestore.delete(FirestoreCollections.EXPENSES, id);
        return Map.of("ok", true);
    }
}
