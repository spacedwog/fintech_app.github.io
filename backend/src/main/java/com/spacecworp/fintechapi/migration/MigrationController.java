package com.spacecworp.fintechapi.migration;

import com.spacecworp.fintechapi.auth.TenantDocument;
import com.spacecworp.fintechapi.expenses.CategoryDocument;
import com.spacecworp.fintechapi.expenses.ExpenseDocument;
import com.spacecworp.fintechapi.expenses.ExpenseRuleDocument;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.governance.AuditEventDocument;
import com.spacecworp.fintechapi.payments.PaymentDocument;
import com.spacecworp.fintechapi.plans.PlanCatalog;
import com.spacecworp.fintechapi.plans.PlanSubscriptionDocument;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.SecurityUtils;
import com.spacecworp.fintechapi.users.UserDocument;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.*;
import java.util.function.Function;

@RestController
@RequestMapping("/api/v1/migration")
public class MigrationController {
    private final FirestoreGateway firestore;

    public MigrationController(FirestoreGateway firestore) {
        this.firestore = firestore;
    }

    public record ImportPayload(
            List<TenantDocument> tenants,
            List<UserDocument> users,
            List<CategoryDocument> categories,
            List<ExpenseDocument> expenses,
            List<PlanSubscriptionDocument> plans,
            List<PaymentDocument> payments,
            List<ExpenseRuleDocument> expenseRules,
            List<AuditEventDocument> auditEvents
    ) {
    }

    // Formato legado do documento único (fintech_saas/db_v1).
    public record LegacySingleDocPayload(
            List<TenantDocument> tenants,
            List<UserDocument> users,
            List<CategoryDocument> categories,
            List<ExpenseDocument> expenses,
            List<Map<String, Object>> budgets,
            List<PaymentDocument> payments,
            List<Map<String, Object>> ads,
            List<Map<String, Object>> budgetLayouts,
            List<Map<String, Object>> categoryBudgets,
            List<Map<String, Object>> budgetGroups,
            List<ExpenseRuleDocument> expenseRules,
            List<AuditEventDocument> auditEvents,
            Map<String, Object> mercado_pago_status,
            Map<String, Object> _seq
    ) {
    }

    public record RestorePayload(@Valid ImportPayload snapshot, Boolean wipe_first) {
    }

    @PostMapping("/map-legacy")
    public Map<String, Object> mapLegacy(@RequestBody LegacySingleDocPayload legacy) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(user);

        ImportPayload mapped = mapLegacyPayload(legacy);
        Map<String, Integer> mappedCounts = counts(mapped);
        Map<String, Integer> ignoredCounts = Map.of(
                "budgets", safe(legacy.budgets()).size(),
                "ads", safe(legacy.ads()).size(),
                "budgetLayouts", safe(legacy.budgetLayouts()).size(),
                "categoryBudgets", safe(legacy.categoryBudgets()).size(),
                "budgetGroups", safe(legacy.budgetGroups()).size()
        );

        return Map.of(
                "ok", true,
                "mapped", mapped,
                "mapped_counts", mappedCounts,
                "ignored_counts", ignoredCounts,
                "validation_preview", validatePayloadConsistency(mapped)
        );
    }

    @PostMapping("/import")
    public Map<String, Object> importData(@RequestBody ImportPayload payload) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(user);

        int imported = importMappedPayload(payload);
        return Map.of("ok", true, "imported", imported, "counts", counts(payload));
    }

    @PostMapping("/import-legacy")
    public Map<String, Object> importLegacy(@RequestBody LegacySingleDocPayload legacy) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(user);

        ImportPayload mapped = mapLegacyPayload(legacy);
        int imported = importMappedPayload(mapped);
        Map<String, Object> validation = validateCurrentStoreConsistency();

        return Map.of(
                "ok", true,
                "imported", imported,
                "mapped_counts", counts(mapped),
                "ignored_counts", Map.of(
                        "budgets", safe(legacy.budgets()).size(),
                        "ads", safe(legacy.ads()).size(),
                        "budgetLayouts", safe(legacy.budgetLayouts()).size(),
                        "categoryBudgets", safe(legacy.categoryBudgets()).size(),
                        "budgetGroups", safe(legacy.budgetGroups()).size()
                ),
                "validation", validation
        );
    }

    @GetMapping("/validate")
    public Map<String, Object> validate() {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(user);
        return validateCurrentStoreConsistency();
    }

    @GetMapping("/snapshot")
    public Map<String, Object> snapshot() {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(user);

        ImportPayload payload = readCurrentAsImportPayload();
        return Map.of(
                "ok", true,
                "generated_at", OffsetDateTime.now().toString(),
                "counts", counts(payload),
                "snapshot", payload
        );
    }

    @PostMapping("/restore")
    public Map<String, Object> restore(@Valid @RequestBody RestorePayload restore) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(user);

        boolean wipeFirst = Boolean.TRUE.equals(restore.wipe_first());
        if (wipeFirst) wipeTargetCollections();
        int restored = importMappedPayload(restore.snapshot());

        return Map.of(
                "ok", true,
                "wipe_first", wipeFirst,
                "restored", restored,
                "counts", counts(restore.snapshot()),
                "validation", validateCurrentStoreConsistency()
        );
    }

    @GetMapping("/cutover-runbook")
    public Map<String, Object> cutoverRunbook() {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(user);

        List<String> preCutover = List.of(
                "Congelar deploys e mudanças de schema durante a janela de cutover",
                "Gerar backup do backend alvo em GET /api/v1/migration/snapshot",
                "Gerar snapshot do legado (fintech_saas/db_v1) por ambiente/tenant",
                "Executar POST /api/v1/migration/map-legacy e revisar validation_preview"
        );
        List<String> cutover = List.of(
                "Executar POST /api/v1/migration/import-legacy com snapshot final do legado",
                "Executar GET /api/v1/migration/validate e bloquear virada se consistent=false",
                "Apontar frontend para backend REST (fintech_api_base_url)",
                "Monitorar logs estruturados e eventos de auditoria por 30 minutos"
        );
        List<String> rollback = List.of(
                "Se houver falha crítica, reverter frontend para modo legado removendo fintech_api_base_url",
                "Restaurar snapshot alvo pré-cutover com POST /api/v1/migration/restore (wipe_first=true)",
                "Registrar incidente e reexecutar cutover apenas após correção e nova validação"
        );

        return Map.of(
                "ok", true,
                "strategy", "big_bang_single_cutover",
                "pre_cutover", preCutover,
                "cutover", cutover,
                "rollback", rollback,
                "success_criteria", List.of(
                        "validate.consistent=true",
                        "sem erros 5xx em auth/expenses/plans/payments no período de estabilização",
                        "trilha de auditoria registrando pagamentos e mudança de plano"
                )
        );
    }

    private ImportPayload mapLegacyPayload(LegacySingleDocPayload legacy) {
        List<TenantDocument> tenants = safe(legacy.tenants());
        List<UserDocument> users = safe(legacy.users());
        List<CategoryDocument> categories = safe(legacy.categories());
        List<ExpenseDocument> expenses = safe(legacy.expenses());
        List<PaymentDocument> payments = safe(legacy.payments());
        List<ExpenseRuleDocument> expenseRules = safe(legacy.expenseRules());
        List<AuditEventDocument> auditEvents = safe(legacy.auditEvents());

        Map<String, PlanSubscriptionDocument> plansByTenant = new LinkedHashMap<>();
        for (TenantDocument tenant : tenants) {
            if (tenant == null || blank(tenant.id)) continue;
            String planCode = normalizePlan(tenant.plan);
            PlanSubscriptionDocument plan = new PlanSubscriptionDocument(
                    "plan_" + tenant.id,
                    tenant.id,
                    planCode,
                    tenant.created_at == null ? OffsetDateTime.now().toString() : tenant.created_at
            );
            plansByTenant.put(tenant.id, plan);
        }

        for (ExpenseDocument e : expenses) {
            if (e == null) continue;
            if (e.created_at == null) e.created_at = e.date == null ? OffsetDateTime.now().toString() : e.date;
            if (e.generated_by_mercado_pago_source == null) e.generated_by_mercado_pago_source = null;
            if (e.extra_charge < 0) e.extra_charge = 0;
        }

        for (PaymentDocument p : payments) {
            if (p == null) continue;
            if (p.date == null) p.date = OffsetDateTime.now().toString();
            if (p.verifiedByAI == null) p.verifiedByAI = false;
            if (p.verifiedByMercadoPago == null) p.verifiedByMercadoPago = false;
        }

        return new ImportPayload(
                tenants,
                users,
                categories,
                expenses,
                new ArrayList<>(plansByTenant.values()),
                payments,
                expenseRules,
                auditEvents
        );
    }

    private String normalizePlan(String plan) {
        if (plan == null || plan.isBlank()) return "free";
        PlanCatalog.PlanDto p = PlanCatalog.find(plan.toLowerCase());
        return p == null ? "free" : p.code();
    }

    private int importMappedPayload(ImportPayload payload) {
        int imported = 0;
        imported += importList(FirestoreCollections.TENANTS, payload.tenants(), x -> x.id);
        imported += importList(FirestoreCollections.USERS, payload.users(), x -> x.id);
        imported += importList(FirestoreCollections.CATEGORIES, payload.categories(), x -> x.id);
        imported += importList(FirestoreCollections.EXPENSES, payload.expenses(), x -> x.id);
        imported += importList(FirestoreCollections.PLANS, payload.plans(), x -> x.id);
        imported += importList(FirestoreCollections.PAYMENTS, payload.payments(), x -> x.id);
        imported += importList(FirestoreCollections.EXPENSE_RULES, payload.expenseRules(), x -> x.id);
        imported += importList(FirestoreCollections.AUDIT_EVENTS, payload.auditEvents(), x -> x.id);
        return imported;
    }

    private void wipeTargetCollections() {
        List<String> collections = List.of(
                FirestoreCollections.AUDIT_EVENTS,
                FirestoreCollections.EXPENSE_RULES,
                FirestoreCollections.PAYMENTS,
                FirestoreCollections.PLANS,
                FirestoreCollections.EXPENSES,
                FirestoreCollections.CATEGORIES,
                FirestoreCollections.USERS,
                FirestoreCollections.TENANTS
        );
        for (String collection : collections) {
            for (String id : firestore.listDocumentIds(collection)) {
                firestore.delete(collection, id);
            }
        }
    }

    private ImportPayload readCurrentAsImportPayload() {
        return new ImportPayload(
                firestore.listAll(FirestoreCollections.TENANTS, TenantDocument.class),
                firestore.listAll(FirestoreCollections.USERS, UserDocument.class),
                firestore.listAll(FirestoreCollections.CATEGORIES, CategoryDocument.class),
                firestore.listAll(FirestoreCollections.EXPENSES, ExpenseDocument.class),
                firestore.listAll(FirestoreCollections.PLANS, PlanSubscriptionDocument.class),
                firestore.listAll(FirestoreCollections.PAYMENTS, PaymentDocument.class),
                firestore.listAll(FirestoreCollections.EXPENSE_RULES, ExpenseRuleDocument.class),
                firestore.listAll(FirestoreCollections.AUDIT_EVENTS, AuditEventDocument.class)
        );
    }

    private Map<String, Object> validateCurrentStoreConsistency() {
        return validatePayloadConsistency(readCurrentAsImportPayload());
    }

    private Map<String, Object> validatePayloadConsistency(ImportPayload payload) {
        List<TenantDocument> tenants = safe(payload.tenants());
        List<UserDocument> users = safe(payload.users());
        List<CategoryDocument> categories = safe(payload.categories());
        List<ExpenseDocument> expenses = safe(payload.expenses());
        List<PlanSubscriptionDocument> plans = safe(payload.plans());
        List<PaymentDocument> payments = safe(payload.payments());
        List<ExpenseRuleDocument> expenseRules = safe(payload.expenseRules());
        List<AuditEventDocument> auditEvents = safe(payload.auditEvents());

        Set<String> tenantIds = new HashSet<>();
        for (TenantDocument t : tenants) if (t != null && !blank(t.id)) tenantIds.add(t.id);

        Map<String, String> userTenant = new HashMap<>();
        Set<String> userIds = new HashSet<>();
        List<String> issues = new ArrayList<>();

        for (UserDocument u : users) {
            if (u == null || blank(u.id)) {
                issues.add("user_without_id");
                continue;
            }
            userIds.add(u.id);
            userTenant.put(u.id, u.tenant_id);
            if (blank(u.tenant_id) || !tenantIds.contains(u.tenant_id)) {
                issues.add("user_invalid_tenant:" + u.id);
            }
        }

        for (CategoryDocument c : categories) {
            if (c == null || blank(c.id)) {
                issues.add("category_without_id");
                continue;
            }
            if (blank(c.tenant_id) || !tenantIds.contains(c.tenant_id)) {
                issues.add("category_invalid_tenant:" + c.id);
            }
        }

        Set<String> categoryIds = new HashSet<>();
        for (CategoryDocument c : categories) if (c != null && !blank(c.id)) categoryIds.add(c.id);

        for (ExpenseDocument e : expenses) {
            if (e == null || blank(e.id)) {
                issues.add("expense_without_id");
                continue;
            }
            if (blank(e.tenant_id) || !tenantIds.contains(e.tenant_id)) {
                issues.add("expense_invalid_tenant:" + e.id);
            }
            if (blank(e.user_id) || !userIds.contains(e.user_id)) {
                issues.add("expense_invalid_user:" + e.id);
            }
            if (!blank(e.category_id) && !categoryIds.contains(e.category_id)) {
                issues.add("expense_invalid_category:" + e.id);
            }
        }

        for (PaymentDocument p : payments) {
            if (p == null || blank(p.id)) {
                issues.add("payment_without_id");
                continue;
            }
            if (blank(p.tenant_id) || !tenantIds.contains(p.tenant_id)) {
                issues.add("payment_invalid_tenant:" + p.id);
            }
            if (blank(p.user_id) || !userIds.contains(p.user_id)) {
                issues.add("payment_invalid_user:" + p.id);
            }
        }

        for (PlanSubscriptionDocument p : plans) {
            if (p == null || blank(p.id)) {
                issues.add("plan_without_id");
                continue;
            }
            if (blank(p.tenant_id) || !tenantIds.contains(p.tenant_id)) {
                issues.add("plan_invalid_tenant:" + p.id);
            }
        }

        for (ExpenseRuleDocument r : expenseRules) {
            if (r == null || blank(r.id)) {
                issues.add("expense_rule_without_id");
                continue;
            }
            if (blank(r.tenant_id) || !tenantIds.contains(r.tenant_id)) {
                issues.add("expense_rule_invalid_tenant:" + r.id);
            }
            if (blank(r.category_id) || !categoryIds.contains(r.category_id)) {
                issues.add("expense_rule_invalid_category:" + r.id);
            }
        }

        Map<String, Map<String, Integer>> byTenant = new LinkedHashMap<>();
        for (String tenantId : tenantIds) {
            byTenant.put(tenantId, new LinkedHashMap<>(Map.of(
                    "users", 0,
                    "categories", 0,
                    "expenses", 0,
                    "payments", 0,
                    "plans", 0,
                    "expense_rules", 0,
                    "audit_events", 0
            )));
        }

        users.forEach(u -> bump(byTenant, u == null ? null : u.tenant_id, "users"));
        categories.forEach(c -> bump(byTenant, c == null ? null : c.tenant_id, "categories"));
        expenses.forEach(e -> bump(byTenant, e == null ? null : e.tenant_id, "expenses"));
        payments.forEach(p -> bump(byTenant, p == null ? null : p.tenant_id, "payments"));
        plans.forEach(p -> bump(byTenant, p == null ? null : p.tenant_id, "plans"));
        expenseRules.forEach(r -> bump(byTenant, r == null ? null : r.tenant_id, "expense_rules"));
        auditEvents.forEach(a -> bump(byTenant, a == null ? null : a.tenant_id, "audit_events"));

        Map<String, Map<String, Object>> byUser = new LinkedHashMap<>();
        for (UserDocument u : users) {
            if (u == null || blank(u.id)) continue;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("tenant_id", u.tenant_id);
            row.put("expenses", 0);
            row.put("payments", 0);
            row.put("audit_events", 0);
            byUser.put(u.id, row);
        }
        expenses.forEach(e -> bumpUser(byUser, e == null ? null : e.user_id, "expenses"));
        payments.forEach(p -> bumpUser(byUser, p == null ? null : p.user_id, "payments"));
        auditEvents.forEach(a -> bumpUser(byUser, a == null ? null : a.user_id, "audit_events"));

        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("tenants", tenants.size());
        totals.put("users", users.size());
        totals.put("categories", categories.size());
        totals.put("expenses", expenses.size());
        totals.put("plans", plans.size());
        totals.put("payments", payments.size());
        totals.put("expense_rules", expenseRules.size());
        totals.put("audit_events", auditEvents.size());

        return Map.of(
                "consistent", issues.isEmpty(),
                "issues", issues,
                "totals", totals,
                "by_tenant", byTenant,
                "by_user", byUser
        );
    }

    private void bump(Map<String, Map<String, Integer>> byTenant, String tenantId, String key) {
        if (tenantId == null || !byTenant.containsKey(tenantId)) return;
        Map<String, Integer> row = byTenant.get(tenantId);
        row.put(key, row.getOrDefault(key, 0) + 1);
    }

    private void bumpUser(Map<String, Map<String, Object>> byUser, String userId, String key) {
        if (userId == null || !byUser.containsKey(userId)) return;
        Map<String, Object> row = byUser.get(userId);
        int cur = row.get(key) instanceof Number n ? n.intValue() : 0;
        row.put(key, cur + 1);
    }

    private Map<String, Integer> counts(ImportPayload payload) {
        return Map.of(
                "tenants", safe(payload.tenants()).size(),
                "users", safe(payload.users()).size(),
                "categories", safe(payload.categories()).size(),
                "expenses", safe(payload.expenses()).size(),
                "plans", safe(payload.plans()).size(),
                "payments", safe(payload.payments()).size(),
                "expense_rules", safe(payload.expenseRules()).size(),
                "audit_events", safe(payload.auditEvents()).size()
        );
    }

    private <T> int importList(String collection, List<T> items, Function<T, String> idFn) {
        List<T> list = safe(items);
        int imported = 0;
        for (T item : list) {
            if (item == null) continue;
            String id = idFn.apply(item);
            if (blank(id)) continue;
            firestore.save(collection, id, item);
            imported++;
        }
        return imported;
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private <T> List<T> safe(List<T> list) {
        return list == null ? List.of() : list;
    }
}
