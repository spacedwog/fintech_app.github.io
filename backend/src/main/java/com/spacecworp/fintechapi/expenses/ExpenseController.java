package com.spacecworp.fintechapi.expenses;

import com.spacecworp.fintechapi.common.ApiException;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.plans.PlanCatalog;
import com.spacecworp.fintechapi.plans.PlanController;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.SecurityUtils;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Comparator;
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
    public record ExpenseRuleRequest(@NotBlank String category_id, @NotBlank String keyword, String match_type) {}
    public record ApplyRulesRequest(String month) {}

    public record ExpenseRequest(
            @DecimalMin(value = "0.01") double amount,
            @NotBlank String date,
            @NotBlank String description,
            String category_id,
            String transaction_number,
            String idempotency_key
    ) {}

    @GetMapping("/categories")
    public List<CategoryDocument> listCategories() {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireScope(user, "categories:read");
        return firestore.listByField(FirestoreCollections.CATEGORIES, "tenant_id", user.tenantId(), CategoryDocument.class);
    }

    @PostMapping("/categories")
    public CategoryDocument addCategory(@Valid @RequestBody CategoryRequest req) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireScope(user, "categories:write");
        String id = firestore.nextId(FirestoreCollections.CATEGORIES);
        CategoryDocument doc = new CategoryDocument(id, user.tenantId(), req.name().trim());
        firestore.save(FirestoreCollections.CATEGORIES, id, doc);
        return doc;
    }

    @GetMapping("/expense-rules")
    public List<ExpenseRuleDocument> listExpenseRules() {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireScope(user, "expense_rules:read");
        return firestore.listByField(FirestoreCollections.EXPENSE_RULES, "tenant_id", user.tenantId(), ExpenseRuleDocument.class);
    }

    @PostMapping("/expense-rules")
    public ExpenseRuleDocument addExpenseRule(@Valid @RequestBody ExpenseRuleRequest req) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireScope(user, "expense_rules:write");
        boolean categoryExists = !firestore.listByFields(FirestoreCollections.CATEGORIES, Map.of("tenant_id", user.tenantId(), "id", req.category_id()), CategoryDocument.class).isEmpty();
        if (!categoryExists) throw new ApiException(HttpStatus.BAD_REQUEST, "Categoria inválida");

        String id = firestore.nextId(FirestoreCollections.EXPENSE_RULES);
        ExpenseRuleDocument doc = new ExpenseRuleDocument();
        doc.id = id;
        doc.tenant_id = user.tenantId();
        doc.category_id = req.category_id();
        doc.keyword = req.keyword().trim();
        doc.match_type = (req.match_type() == null || req.match_type().isBlank()) ? "contains" : req.match_type().toLowerCase();
        firestore.save(FirestoreCollections.EXPENSE_RULES, id, doc);
        return doc;
    }

    @DeleteMapping("/expense-rules/{id}")
    public Map<String, Object> deleteExpenseRule(@PathVariable String id) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireScope(user, "expense_rules:write");
        ExpenseRuleDocument current = firestore.findById(FirestoreCollections.EXPENSE_RULES, id, ExpenseRuleDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Regra não encontrada"));
        if (!user.tenantId().equals(current.tenant_id)) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        firestore.delete(FirestoreCollections.EXPENSE_RULES, id);
        return Map.of("ok", true);
    }

    @GetMapping("/expenses")
    public List<ExpenseDocument> listExpenses(
            @RequestParam(defaultValue = "false") boolean allUsers,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String month,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireScope(user, "expenses:read");
        boolean canSeeAllUsers = allUsers && "admin".equals(user.role());
        int resolvedLimit = normalizeLimit(limit, 1000);
        int resolvedOffset = Math.max(0, offset == null ? 0 : offset);
        List<ExpenseDocument> tenantExpenses = firestore.listByField(FirestoreCollections.EXPENSES, "tenant_id", user.tenantId(), ExpenseDocument.class);
        return tenantExpenses.stream()
                .filter(e -> canSeeAllUsers || user.userId().equals(e.user_id))
                .filter(e -> month == null || month.isBlank() || safe(e.date).startsWith(month))
                .filter(e -> from == null || from.isBlank() || safe(e.date).compareTo(from) >= 0)
                .filter(e -> to == null || to.isBlank() || safe(e.date).compareTo(to) <= 0)
                .sorted(Comparator.comparing((ExpenseDocument e) -> safe(e.date)).reversed())
                .skip(resolvedOffset)
                .limit(resolvedLimit)
                .toList();
    }

    @GetMapping("/expenses/quota")
    public Map<String, Object> quota() {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireScope(user, "expenses:read");
        PlanCatalog.PlanDto plan = PlanCatalog.find(planController.currentSubscription(user.tenantId()).plan);
        int usedToday = (int) firestore.listByField(FirestoreCollections.EXPENSES, "tenant_id", user.tenantId(), ExpenseDocument.class).stream()
                .filter(e -> user.userId().equals(e.user_id))
                .filter(e -> LocalDate.now().toString().equals(e.date))
                .count();
        int limit = plan.daily_expense_limit();
        int remaining = limit == Integer.MAX_VALUE ? Integer.MAX_VALUE : Math.max(0, limit - usedToday);
        int extraUnits = limit == Integer.MAX_VALUE ? 0 : Math.max(0, usedToday - limit + 1);
        return Map.of(
                "plan", plan.code(),
                "daily_limit", limit,
                "used_today", usedToday,
                "remaining_today", remaining,
                "over_quota", limit != Integer.MAX_VALUE && usedToday >= limit,
                "overage_price", plan.overage_price(),
                "extra_units_if_next_expense", extraUnits,
                "extra_charge_if_next_expense", extraUnits * plan.overage_price()
        );
    }

    @PostMapping("/expenses")
    public ExpenseDocument addExpense(@Valid @RequestBody ExpenseRequest req) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireScope(user, "expenses:write");
        if (safe(req.idempotency_key()).length() >= 8) {
            ExpenseDocument existingByKey = firestore.listByField(FirestoreCollections.EXPENSES, "tenant_id", user.tenantId(), ExpenseDocument.class).stream()
                    .filter(e -> user.userId().equals(e.user_id))
                    .filter(e -> safe(req.idempotency_key()).equalsIgnoreCase(safe(e.idempotency_key)))
                    .findFirst()
                    .orElse(null);
            if (existingByKey != null) return existingByKey;
        }
        if (!safe(req.transaction_number()).isBlank()) {
            ExpenseDocument existingByTxn = firestore.listByField(FirestoreCollections.EXPENSES, "tenant_id", user.tenantId(), ExpenseDocument.class).stream()
                    .filter(e -> user.userId().equals(e.user_id))
                    .filter(e -> safe(req.transaction_number()).equalsIgnoreCase(safe(e.transaction_number)))
                    .filter(e -> safe(req.date()).equals(safe(e.date)))
                    .filter(e -> Double.compare(req.amount(), e.amount) == 0)
                    .findFirst()
                    .orElse(null);
            if (existingByTxn != null) return existingByTxn;
        }
        Map<String, Object> quota = quota();
        boolean isExtra = Boolean.TRUE.equals(quota.get("over_quota"));
        double extraCharge = Number.class.isInstance(quota.get("overage_price")) ? ((Number) quota.get("overage_price")).doubleValue() : 0.0;
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
        doc.generated_by_mercado_pago_source = null;
        doc.mercado_pago_payment_id = null;
        doc.idempotency_key = safe(req.idempotency_key()).isBlank() ? null : safe(req.idempotency_key());
        doc.created_at = OffsetDateTime.now().toString();
        doc.is_extra = isExtra;
        doc.extra_charge = isExtra ? extraCharge : 0.0;
        if (doc.category_id == null || doc.category_id.isBlank()) {
            doc.category_id = resolveCategoryByRule(user.tenantId(), doc.description);
            doc.auto_categorized_by_rule = doc.category_id != null && !doc.category_id.isBlank();
        } else {
            doc.auto_categorized_by_rule = false;
        }
        firestore.save(FirestoreCollections.EXPENSES, id, doc);
        return doc;
    }

    @PutMapping("/expenses/{id}")
    public ExpenseDocument updateExpense(@PathVariable String id, @Valid @RequestBody ExpenseRequest req) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireScope(user, "expenses:write");
        ExpenseDocument current = firestore.findById(FirestoreCollections.EXPENSES, id, ExpenseDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Despesa não encontrada"));
        if (!user.tenantId().equals(current.tenant_id)) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        current.amount = req.amount();
        current.date = req.date();
        current.description = req.description();
        current.category_id = req.category_id();
        current.transaction_number = req.transaction_number();
        if (current.category_id == null || current.category_id.isBlank()) {
            current.category_id = resolveCategoryByRule(user.tenantId(), current.description);
            current.auto_categorized_by_rule = current.category_id != null && !current.category_id.isBlank();
        } else {
            current.auto_categorized_by_rule = false;
        }
        firestore.save(FirestoreCollections.EXPENSES, id, current);
        return current;
    }

    @DeleteMapping("/expenses/{id}")
    public Map<String, Object> deleteExpense(@PathVariable String id) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireScope(user, "expenses:write");
        ExpenseDocument current = firestore.findById(FirestoreCollections.EXPENSES, id, ExpenseDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Despesa não encontrada"));
        if (!user.tenantId().equals(current.tenant_id)) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        firestore.delete(FirestoreCollections.EXPENSES, id);
        return Map.of("ok", true);
    }

    @PostMapping("/expenses/apply-rules")
    public Map<String, Object> applyRules(@RequestBody(required = false) ApplyRulesRequest payload) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireScope(user, "expenses:write");
        String month = payload == null ? null : payload.month();

        List<ExpenseRuleDocument> rules = firestore.listByField(FirestoreCollections.EXPENSE_RULES, "tenant_id", user.tenantId(), ExpenseRuleDocument.class);
        List<ExpenseDocument> expenses = firestore.listByField(FirestoreCollections.EXPENSES, "tenant_id", user.tenantId(), ExpenseDocument.class);

        int updated = 0;
        for (ExpenseDocument expense : expenses) {
            boolean shouldProcess = (expense.category_id == null || expense.category_id.isBlank())
                    && (month == null || month.isBlank() || safe(expense.date).startsWith(month));
            if (!shouldProcess) continue;

            String text = safe(expense.description).toLowerCase();
            for (ExpenseRuleDocument rule : rules) {
                String keyword = safe(rule.keyword).toLowerCase();
                boolean match = "exact".equals(rule.match_type)
                        ? text.equals(keyword)
                        : text.contains(keyword);
                if (match) {
                    expense.category_id = rule.category_id;
                    expense.auto_categorized_by_rule = true;
                    firestore.save(FirestoreCollections.EXPENSES, expense.id, expense);
                    updated++;
                    break;
                }
            }
        }

        return Map.of("ok", true, "updated", updated);
    }

    private String safe(String value) {
        return value == null ? "" : value;
    }

    private int normalizeLimit(Integer value, int fallback) {
        if (value == null) return fallback;
        return Math.max(1, Math.min(value, 5000));
    }

    private String resolveCategoryByRule(String tenantId, String description) {
        String normalizedDescription = normalize(description);
        if (normalizedDescription.isBlank()) return null;
        List<ExpenseRuleDocument> rules = firestore.listByField(FirestoreCollections.EXPENSE_RULES, "tenant_id", tenantId, ExpenseRuleDocument.class);
        for (ExpenseRuleDocument rule : rules) {
            String keyword = normalize(rule.keyword);
            if (keyword.isBlank()) continue;
            boolean match = "exact".equalsIgnoreCase(safe(rule.match_type))
                    ? normalizedDescription.equals(keyword)
                    : normalizedDescription.contains(keyword);
            if (match) return rule.category_id;
        }
        return null;
    }

    private String normalize(String value) {
        String v = safe(value).toLowerCase().trim();
        if (v.isBlank()) return "";
        return java.text.Normalizer.normalize(v, java.text.Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .replaceAll("[^a-z0-9\\s]", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }
}
