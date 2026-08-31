package com.spacecworp.fintechapi.reports;

import com.spacecworp.fintechapi.ads.AdDocument;
import com.spacecworp.fintechapi.common.ApiException;
import com.spacecworp.fintechapi.budgets.BudgetDocument;
import com.spacecworp.fintechapi.budgets.BudgetGroupDocument;
import com.spacecworp.fintechapi.budgets.BudgetLayoutDocument;
import com.spacecworp.fintechapi.budgets.CategoryBudgetDocument;
import com.spacecworp.fintechapi.expenses.CategoryDocument;
import com.spacecworp.fintechapi.expenses.ExpenseDocument;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.governance.AuditService;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.users.UserDocument;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@RestController
@RequestMapping("/api/v1")
@Validated
public class SystemController {
    private final FirestoreGateway firestoreGateway;
    private final AuditService auditService;

    public SystemController(FirestoreGateway firestoreGateway, AuditService auditService) {
        this.firestoreGateway = firestoreGateway;
        this.auditService = auditService;
    }

    @GetMapping("/budgets")
    public List<BudgetDocument> listBudgets(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                            @RequestParam(required = false) String month) {
        List<BudgetDocument> list = firestoreGateway.listByField(FirestoreCollections.BUDGETS, "tenant_id", currentUser.tenantId(), BudgetDocument.class);
        return list.stream().filter(b -> month == null || month.equals(b.month)).collect(Collectors.toList());
    }

    @PostMapping("/budgets")
    public BudgetDocument setBudget(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                    @Valid @RequestBody SetBudgetRequest request) {
        double limit = request.limit_value != null ? request.limit_value : (request.limit != null ? request.limit : Double.NaN);
        if (!Double.isFinite(limit)) throw new IllegalArgumentException("Limite é obrigatório.");
        List<BudgetDocument> list = firestoreGateway.listByField(FirestoreCollections.BUDGETS, "tenant_id", currentUser.tenantId(), BudgetDocument.class);
        Optional<BudgetDocument> existing = list.stream().filter(b -> Objects.equals(b.user_id, currentUser.userId()) && Objects.equals(b.month, request.month)).findFirst();
        BudgetDocument doc = existing.orElseGet(BudgetDocument::new);
        doc.id = existing.map(d -> d.id).orElse(UUID.randomUUID().toString());
        doc.tenant_id = currentUser.tenantId();
        doc.user_id = currentUser.userId();
        doc.month = request.month;
        doc.limit_value = limit;
        firestoreGateway.save(FirestoreCollections.BUDGETS, doc.id, doc);
        return doc;
    }

    @DeleteMapping("/budgets/{id}")
    public Map<String, Object> deleteBudget(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                            @PathVariable String id) {
        BudgetDocument doc = firestoreGateway.findById(FirestoreCollections.BUDGETS, id, BudgetDocument.class)
                .orElseThrow(() -> new NoSuchElementException("Budget not found"));
        if (!currentUser.tenantId().equals(doc.tenant_id)) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        firestoreGateway.delete(FirestoreCollections.BUDGETS, id);
        return Map.of("ok", true);
    }

    @GetMapping("/alerts")
    public Map<String, Object> getAlerts(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                         @RequestParam(required = false) String month) {
        String targetMonth = month != null ? month : Instant.now().toString().substring(0, 7);
        List<ExpenseDocument> expenses = firestoreGateway.listByField(FirestoreCollections.EXPENSES, "tenant_id", currentUser.tenantId(), ExpenseDocument.class);
        double total = expenses.stream()
                .filter(e -> currentUser.userId().equals(e.user_id) && e.date != null && e.date.startsWith(targetMonth))
                .mapToDouble(e -> e.amount).sum();
        double limit = firestoreGateway.listByField(FirestoreCollections.BUDGETS, "tenant_id", currentUser.tenantId(), BudgetDocument.class)
                .stream().filter(b -> currentUser.userId().equals(b.user_id) && targetMonth.equals(b.month))
                .findFirst().map(b -> b.limit_value).orElse(0d);
        double percent = limit > 0 ? Math.round((total / limit) * 10000d) / 100d : 0d;
        return Map.of(
                "month", targetMonth,
                "total", total,
                "limit", limit,
                "percent", percent,
                "near", limit > 0 && percent >= 80d && percent < 100d,
                "over", limit > 0 && total > limit
        );
    }

    @GetMapping("/category-budgets")
    public List<CategoryBudgetDocument> listCategoryBudgets(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                                            @RequestParam(required = false) String month) {
        return firestoreGateway.listByField(FirestoreCollections.CATEGORY_BUDGETS, "tenant_id", currentUser.tenantId(), CategoryBudgetDocument.class)
                .stream().filter(c -> month == null || month.equals(c.month)).collect(Collectors.toList());
    }

    @PostMapping("/category-budgets")
    public CategoryBudgetDocument upsertCategoryBudget(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                                       @Valid @RequestBody UpsertCategoryBudgetRequest request) {
        List<CategoryBudgetDocument> existingRows = firestoreGateway.listByField(FirestoreCollections.CATEGORY_BUDGETS, "tenant_id", currentUser.tenantId(), CategoryBudgetDocument.class);
        Optional<CategoryBudgetDocument> existing = existingRows.stream().filter(cb ->
                (request.budget_id != null && request.budget_id.equals(cb.id)) ||
                        (request.category_id != null && request.month.equals(cb.month) && request.category_id.equals(cb.category_id)) ||
                        (request.category_id == null && request.category_name != null && request.month.equals(cb.month) && request.category_name.equalsIgnoreCase(String.valueOf(cb.category_name)))
        ).findFirst();
        CategoryBudgetDocument doc = existing.orElseGet(CategoryBudgetDocument::new);
        doc.id = existing.map(d -> d.id).orElse(UUID.randomUUID().toString());
        doc.tenant_id = currentUser.tenantId();
        doc.category_id = request.category_id;
        doc.category_name = request.category_name;
        doc.month = request.month;
        doc.previsto = request.previsto;
        doc.imported_from_budget = request.imported_from_budget == null || request.imported_from_budget;
        firestoreGateway.save(FirestoreCollections.CATEGORY_BUDGETS, doc.id, doc);
        return doc;
    }

    @DeleteMapping("/category-budgets/{id}")
    public Map<String, Object> deleteCategoryBudget(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser, @PathVariable String id) {
        CategoryBudgetDocument doc = firestoreGateway.findById(FirestoreCollections.CATEGORY_BUDGETS, id, CategoryBudgetDocument.class)
                .orElseThrow(() -> new NoSuchElementException("Category budget not found"));
        if (!currentUser.tenantId().equals(doc.tenant_id)) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        firestoreGateway.delete(FirestoreCollections.CATEGORY_BUDGETS, id);
        return Map.of("ok", true);
    }

    @PostMapping("/category-budgets/import")
    public Map<String, Object> importCategoryBudgets(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                                     @Valid @RequestBody ImportCategoryBudgetsRequest request) {
        Map<String, Double> rowsByCategory = new LinkedHashMap<>();
        for (ImportCategoryBudgetsRequest.Line row : request.rows) {
            String categoryName = String.valueOf(row.categoria == null ? "" : row.categoria).trim();
            if (categoryName.isBlank()) continue;
            rowsByCategory.merge(categoryName, row.previsto, Double::sum);
        }
        int created = 0;
        List<Map<String, Object>> applied = new ArrayList<>();
        List<CategoryBudgetDocument> existingRows = firestoreGateway.listByField(FirestoreCollections.CATEGORY_BUDGETS, "tenant_id", currentUser.tenantId(), CategoryBudgetDocument.class);
        for (Map.Entry<String, Double> row : rowsByCategory.entrySet()) {
            Optional<CategoryBudgetDocument> existing = existingRows.stream()
                    .filter(cb -> request.month.equals(cb.month) && row.getKey().equalsIgnoreCase(String.valueOf(cb.category_name)))
                    .findFirst();
            CategoryBudgetDocument doc = new CategoryBudgetDocument();
            doc.id = existing.map(d -> d.id).orElse(UUID.randomUUID().toString());
            doc.tenant_id = currentUser.tenantId();
            doc.category_id = existing.map(d -> d.category_id).orElse(null);
            doc.category_name = row.getKey();
            doc.month = request.month;
            doc.previsto = row.getValue();
            doc.imported_from_budget = true;
            firestoreGateway.save(FirestoreCollections.CATEGORY_BUDGETS, doc.id, doc);
            created++;
            applied.add(Map.of("category_id", doc.category_id, "category_name", doc.category_name, "previsto", doc.previsto));
        }
        auditService.record(
                currentUser,
                "budget.category_imported",
                "category_budget",
                "",
                "Imported category budgets",
                new LinkedHashMap<>(Map.of("count", created, "month", request.month))
        );
        return Map.of("month", request.month, "created_categories", 0, "categories_count", applied.size(), "rows", applied, "is_extra", false, "extra_charge", 0);
    }

    @GetMapping("/category-budgets/quota")
    public Map<String, Object> getCategoryBudgetImportQuota(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser) {
        List<Map> userEvents = firestoreGateway.listByField(FirestoreCollections.AUDIT_EVENTS, "tenant_id", currentUser.tenantId(), Map.class);
        long used = userEvents.stream().filter(e -> Objects.equals(e.get("user_id"), currentUser.userId()) && Objects.equals(e.get("action"), "budget.category_imported")).count();
        long dailyLimit = "admin".equals(currentUser.role()) ? 999 : 30;
        return Map.of("plan", "free", "used_today", used, "max_per_day", dailyLimit, "overage_price", 0, "unlimited", false);
    }

    @GetMapping("/category-budgets/overview")
    public Map<String, Object> getBudgetOverview(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                                 @RequestParam(required = false) String month) {
        String targetMonth = month != null ? month : Instant.now().toString().substring(0, 7);
        List<ExpenseDocument> expenses = firestoreGateway.listByField(FirestoreCollections.EXPENSES, "tenant_id", currentUser.tenantId(), ExpenseDocument.class);
        Map<String, Double> realized = expenses.stream()
                .filter(e -> e.date != null && e.date.startsWith(targetMonth))
                .collect(Collectors.groupingBy(e -> String.valueOf(e.category_id), Collectors.summingDouble(e -> e.amount)));
        List<Map<String, Object>> rows = listCategoryBudgets(currentUser, targetMonth).stream().map(cb -> {
            double r = realized.getOrDefault(cb.category_id, 0d);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("category_id", cb.category_id);
            row.put("category_name", cb.category_name);
            row.put("previsto", cb.previsto);
            row.put("realizado", r);
            double saldo = cb.previsto - r;
            row.put("saldo", saldo);
            row.put("status", saldo < 0 ? "ESTOURADO" : "DENTRO_DO_ORCAMENTO");
            return row;
        }).collect(Collectors.toList());
        double totalPrevisto = rows.stream().mapToDouble(r -> ((Number) r.get("previsto")).doubleValue()).sum();
        double totalRealizado = rows.stream().mapToDouble(r -> ((Number) r.get("realizado")).doubleValue()).sum();
        List<Map<String, Object>> alerts = rows.stream().filter(r -> "ESTOURADO".equals(r.get("status"))).collect(Collectors.toList());
        return Map.of(
                "month", targetMonth,
                "rows", rows,
                "totalPrevisto", totalPrevisto,
                "totalRealizado", totalRealizado,
                "saldoTotal", totalPrevisto - totalRealizado,
                "alerts", alerts,
                "overBudget", !alerts.isEmpty(),
                "hasAnyBudget", !rows.isEmpty()
        );
    }

    @PostMapping("/category-budgets/copy-recurring")
    public Map<String, Object> copyRecurringBudget(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                                   @Valid @RequestBody CopyRecurringBudgetRequest request) {
        String sourceMonth = request.sourceMonth;
        if (sourceMonth == null || sourceMonth.isBlank()) {
            sourceMonth = java.time.YearMonth.parse(request.targetMonth).minusMonths(1).toString();
        }
        double factor = 1d + ((request.adjustmentPercent == null ? 0d : request.adjustmentPercent) / 100d);
        List<CategoryBudgetDocument> source = listCategoryBudgets(currentUser, sourceMonth);
        int created = 0;
        int updated = 0;
        List<CategoryBudgetDocument> targetExisting = listCategoryBudgets(currentUser, request.targetMonth);
        for (CategoryBudgetDocument src : source) {
            Optional<CategoryBudgetDocument> existing = targetExisting.stream().filter(t ->
                    Objects.equals(t.category_id, src.category_id) ||
                            (t.category_id == null && src.category_id == null && Objects.equals(t.category_name, src.category_name))
            ).findFirst();
            CategoryBudgetDocument doc = existing.orElseGet(CategoryBudgetDocument::new);
            doc.id = existing.map(d -> d.id).orElse(UUID.randomUUID().toString());
            doc.tenant_id = currentUser.tenantId();
            doc.category_id = src.category_id;
            doc.category_name = src.category_name;
            doc.previsto = Math.round(src.previsto * factor * 100d) / 100d;
            doc.month = request.targetMonth;
            doc.imported_from_budget = src.imported_from_budget;
            firestoreGateway.save(FirestoreCollections.CATEGORY_BUDGETS, doc.id, doc);
            if (existing.isPresent()) updated++; else created++;
        }
        return Map.of(
                "target_month", request.targetMonth,
                "source_month", sourceMonth,
                "adjustment_percent", request.adjustmentPercent == null ? 0 : request.adjustmentPercent,
                "copied_rows", source.size(),
                "created", created,
                "updated", updated
        );
    }

    @GetMapping("/budget-groups")
    public List<BudgetGroupDocument> listBudgetGroups(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser) {
        List<BudgetGroupDocument> groups = firestoreGateway.listByField(FirestoreCollections.BUDGET_GROUPS, "tenant_id", currentUser.tenantId(), BudgetGroupDocument.class);
        groups.sort(Comparator.comparing(g -> String.valueOf(g.name)));
        return groups;
    }

    @GetMapping("/reports/monthly")
    public List<Map<String, Object>> monthlyReport(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                                   @RequestParam(defaultValue = "false") boolean allUsers) {
        List<ExpenseDocument> expenses = scopedExpenses(currentUser, allUsers);
        Map<String, Double> grouped = expenses.stream().collect(Collectors.groupingBy(e -> safeMonth(e.date), Collectors.summingDouble(e -> e.amount)));
        return grouped.entrySet().stream().sorted(Map.Entry.comparingByKey()).map(e -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("month", e.getKey());
            row.put("total", e.getValue());
            return row;
        }).collect(Collectors.toList());
    }

    @GetMapping("/reports/category")
    public List<Map<String, Object>> categoryReport(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                                    @RequestParam(defaultValue = "false") boolean allUsers) {
        List<ExpenseDocument> expenses = scopedExpenses(currentUser, allUsers);
        Map<String, String> categoryNameById = firestoreGateway.listByField(FirestoreCollections.CATEGORIES, "tenant_id", currentUser.tenantId(), CategoryDocument.class)
                .stream().collect(Collectors.toMap(c -> c.id, c -> c.name, (a, b) -> a));
        Map<String, Double> grouped = expenses.stream().collect(Collectors.groupingBy(
                e -> categoryNameById.getOrDefault(e.category_id, "Sem categoria"),
                Collectors.summingDouble(e -> e.amount)));
        return grouped.entrySet().stream().sorted((a, b) -> Double.compare(b.getValue(), a.getValue())).map(e -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("category", e.getKey());
            row.put("total", e.getValue());
            return row;
        }).collect(Collectors.toList());
    }

    @GetMapping("/reports/projection")
    public Map<String, Object> projection(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                          @RequestParam(required = false) String month) {
        String targetMonth = month != null ? month : Instant.now().toString().substring(0, 7);
        List<ExpenseDocument> expenses = scopedExpenses(currentUser, false).stream().filter(e -> e.date != null && e.date.startsWith(targetMonth)).collect(Collectors.toList());
        int daysInMonth = java.time.YearMonth.parse(targetMonth).lengthOfMonth();
        int elapsed = targetMonth.equals(Instant.now().toString().substring(0, 7)) ? java.time.LocalDate.now().getDayOfMonth() : daysInMonth;
        double total = expenses.stream().mapToDouble(e -> e.amount).sum();
        double avg = elapsed > 0 ? total / elapsed : 0;
        double projected = avg * daysInMonth;
        double limit = firestoreGateway.listByField(FirestoreCollections.BUDGETS, "tenant_id", currentUser.tenantId(), BudgetDocument.class)
                .stream().filter(b -> currentUser.userId().equals(b.user_id) && targetMonth.equals(b.month)).findFirst().map(b -> b.limit_value).orElse(0d);
        return Map.of(
                "month", targetMonth,
                "elapsed_days", elapsed,
                "total_days", daysInMonth,
                "total_spent", total,
                "average_per_day", avg,
                "projected_total", projected,
                "limit", limit,
                "projected_percent", limit > 0 ? Math.round((projected / limit) * 100) : 0,
                "projected_over_budget", limit > 0 && projected > limit
        );
    }

    @GetMapping("/reports/monthly-close-checklist")
    public Map<String, Object> closeChecklist(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                              @RequestParam(required = false) String month) {
        String targetMonth = month != null ? month : Instant.now().toString().substring(0, 7);
        List<ExpenseDocument> expenses = scopedExpenses(currentUser, false).stream().filter(e -> e.date != null && e.date.startsWith(targetMonth)).collect(Collectors.toList());
        long uncategorized = expenses.stream().filter(e -> e.category_id == null || e.category_id.isBlank()).count();
        long missingReceipt = expenses.stream().filter(e -> e.transaction_number == null || e.transaction_number.isBlank()).count();
        boolean hasBudget = firestoreGateway.listByField(FirestoreCollections.BUDGETS, "tenant_id", currentUser.tenantId(), BudgetDocument.class)
                .stream().anyMatch(b -> currentUser.userId().equals(b.user_id) && targetMonth.equals(b.month));
        boolean hasCategoryBudget = firestoreGateway.listByField(FirestoreCollections.CATEGORY_BUDGETS, "tenant_id", currentUser.tenantId(), CategoryBudgetDocument.class)
                .stream().anyMatch(b -> targetMonth.equals(b.month));
        List<Map<String, Object>> checklist = List.of(
                Map.of("id", "categorized", "label", "Classificar todas as despesas do mês", "done", uncategorized == 0),
                Map.of("id", "receipts", "label", "Conferir comprovantes (número da transação) das despesas", "done", missingReceipt == 0),
                Map.of("id", "monthly-budget", "label", "Definir limite geral do mês", "done", hasBudget),
                Map.of("id", "category-budget", "label", "Aplicar orçamento por categoria no mês", "done", hasCategoryBudget)
        );
        long doneCount = checklist.stream().filter(i -> Boolean.TRUE.equals(i.get("done"))).count();
        return Map.of(
                "month", targetMonth,
                "expenses_count", expenses.size(),
                "uncategorized_count", uncategorized,
                "missing_receipt_count", missingReceipt,
                "checklist", checklist,
                "done_count", doneCount,
                "total_count", checklist.size(),
                "progress_percent", checklist.isEmpty() ? 0 : Math.round((double) doneCount * 100 / checklist.size())
        );
    }

    @GetMapping("/reports/transaction-origin")
    public Map<String, Object> transactionOrigin(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                                 @RequestParam(required = false) String month) {
        String targetMonth = month != null ? month : Instant.now().toString().substring(0, 7);
        List<ExpenseDocument> expenses = scopedExpenses(currentUser, false).stream().filter(e -> e.date != null && e.date.startsWith(targetMonth)).collect(Collectors.toList());
        Map<String, String> categoryNameById = firestoreGateway.listByField(FirestoreCollections.CATEGORIES, "tenant_id", currentUser.tenantId(), CategoryDocument.class)
                .stream().collect(Collectors.toMap(c -> c.id, c -> c.name, (a, b) -> a));
        List<Map<String, Object>> details = expenses.stream().map(e -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", e.id);
            m.put("date", e.date);
            m.put("description", e.description);
            m.put("amount", e.amount);
            m.put("category_name", categoryNameById.getOrDefault(e.category_id, "Sem categoria"));
            m.put("transaction_number", e.transaction_number);
            m.put("transaction_type", e.generated_by_mercado_pago ? "Pagamento importado (Mercado Pago)" : (e.transaction_number != null && !e.transaction_number.isBlank() ? "Despesa com comprovante" : "Despesa sem comprovante"));
            m.put("detected_origin", e.generated_by_mercado_pago ? "Integração Mercado Pago" : "Lançamento manual no painel");
            m.put("confidence_percent", e.generated_by_mercado_pago ? 95 : 90);
            m.put("reason", e.generated_by_mercado_pago ? "Despesa marcada como gerada automaticamente pelo Mercado Pago." : "Classificação por metadados da despesa.");
            return m;
        }).collect(Collectors.toList());
        return Map.of(
                "month", targetMonth,
                "generated_at", Instant.now().toString(),
                "summary", Map.of("total_transactions", details.size(), "total_amount", details.stream().mapToDouble(d -> ((Number) d.get("amount")).doubleValue()).sum()),
                "breakdown", List.of(),
                "details", details
        );
    }

    @GetMapping("/reports/consolidated-export")
    public Map<String, Object> consolidatedExport(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                                  @RequestParam(required = false) String month) {
        String targetMonth = month != null ? month : Instant.now().toString().substring(0, 7);
        Map<String, Object> projection = projection(currentUser, targetMonth);
        Map<String, Object> checklist = closeChecklist(currentUser, targetMonth);
        Map<String, Object> alerts = getAlerts(currentUser, targetMonth);
        List<ExpenseDocument> expenses = scopedExpenses(currentUser, false).stream().filter(e -> e.date != null && e.date.startsWith(targetMonth)).collect(Collectors.toList());
        return Map.of(
                "exported_at", Instant.now().toString(),
                "month", targetMonth,
                "summary", Map.of("total_expenses", expenses.stream().mapToDouble(e -> e.amount).sum(), "total_budget_limit", alerts.get("limit")),
                "expenses", expenses,
                "budget_overview", getBudgetOverview(currentUser, targetMonth),
                "monthly_projection", projection,
                "monthly_close_checklist", checklist
        );
    }

    @GetMapping("/budget-layouts")
    public List<BudgetLayoutDocument> listBudgetLayouts(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser) {
        return firestoreGateway.listByField(FirestoreCollections.BUDGET_LAYOUTS, "tenant_id", currentUser.tenantId(), BudgetLayoutDocument.class);
    }

    @PostMapping("/budget-layouts")
    public BudgetLayoutDocument createBudgetLayout(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                                   @RequestBody BudgetLayoutDocument request) {
        request.id = UUID.randomUUID().toString();
        request.tenant_id = currentUser.tenantId();
        request.created_at = Instant.now().toString();
        firestoreGateway.save(FirestoreCollections.BUDGET_LAYOUTS, request.id, request);
        return request;
    }

    @DeleteMapping("/budget-layouts/{id}")
    public Map<String, Object> deleteBudgetLayout(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                                   @PathVariable String id) {
        BudgetLayoutDocument doc = firestoreGateway.findById(FirestoreCollections.BUDGET_LAYOUTS, id, BudgetLayoutDocument.class)
                .orElseThrow(() -> new NoSuchElementException("Layout not found"));
        if (!currentUser.tenantId().equals(doc.tenant_id)) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        firestoreGateway.delete(FirestoreCollections.BUDGET_LAYOUTS, id);
        return Map.of("ok", true);
    }

    @GetMapping("/ads")
    public List<AdDocument> listAds(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser) {
        return firestoreGateway.listByField(FirestoreCollections.ADS, "tenant_id", currentUser.tenantId(), AdDocument.class)
                .stream().filter(a -> Boolean.TRUE.equals(a.is_active)).collect(Collectors.toList());
    }

    @PostMapping("/ads")
    public AdDocument createAd(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                               @RequestBody AdDocument request) {
        if (!"admin".equals(currentUser.role())) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        request.id = UUID.randomUUID().toString();
        request.tenant_id = currentUser.tenantId();
        request.user_id = currentUser.userId();
        request.created_at = Instant.now().toString();
        request.updated_at = request.created_at;
        request.is_active = request.is_active == null || request.is_active;
        firestoreGateway.save(FirestoreCollections.ADS, request.id, request);
        return request;
    }

    @PutMapping("/ads/{id}")
    public AdDocument updateAd(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                               @PathVariable String id,
                               @RequestBody AdDocument request) {
        if (!"admin".equals(currentUser.role())) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        AdDocument existing = firestoreGateway.findById(FirestoreCollections.ADS, id, AdDocument.class)
                .orElseThrow(() -> new NoSuchElementException("Ad not found"));
        if (!currentUser.tenantId().equals(existing.tenant_id)) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        existing.title = request.title;
        existing.description = request.description;
        existing.image_url = request.image_url;
        existing.target_url = request.target_url;
        existing.cta_label = request.cta_label;
        existing.placement = request.placement;
        existing.is_active = request.is_active;
        existing.updated_at = Instant.now().toString();
        firestoreGateway.save(FirestoreCollections.ADS, existing.id, existing);
        return existing;
    }

    @DeleteMapping("/ads/{id}")
    public Map<String, Object> deleteAd(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser, @PathVariable String id) {
        if (!"admin".equals(currentUser.role())) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");
        firestoreGateway.delete(FirestoreCollections.ADS, id);
        return Map.of("ok", true);
    }

    @GetMapping("/company-profile")
    public Map<String, Object> getCompanyProfile(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser) {
        return Map.of(
                "tenant_id", currentUser.tenantId(),
                "name", "Empresa",
                "contact_email", "contato@empresa.com",
                "tax_id", "",
                "created_at", ""
        );
    }

    @GetMapping("/privacy-consent")
    public Map<String, Object> getPrivacyConsent(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser) {
        UserDocument me = firestoreGateway.findById(FirestoreCollections.USERS, currentUser.userId(), UserDocument.class)
                .orElseThrow(() -> new NoSuchElementException("User not found"));
        return Map.of(
                "consent_marketing", Boolean.TRUE.equals(me.consent_marketing),
                "consent_updated_at", me.consent_updated_at == null ? "" : me.consent_updated_at
        );
    }

    @PostMapping("/privacy-consent")
    public Map<String, Object> setPrivacyConsent(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                                  @Valid @RequestBody SetPrivacyConsentRequest request) {
        UserDocument me = firestoreGateway.findById(FirestoreCollections.USERS, currentUser.userId(), UserDocument.class)
                .orElseThrow(() -> new NoSuchElementException("User not found"));
        me.consent_marketing = request.consent_marketing;
        me.consent_updated_at = Instant.now().toString();
        firestoreGateway.save(FirestoreCollections.USERS, me.id, me);
        return Map.of("consent_marketing", me.consent_marketing, "consent_updated_at", me.consent_updated_at);
    }

    @GetMapping("/my-data/export")
    public Map<String, Object> exportMyData(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser) {
        UserDocument me = firestoreGateway.findById(FirestoreCollections.USERS, currentUser.userId(), UserDocument.class)
                .orElseThrow(() -> new NoSuchElementException("User not found"));
        List<ExpenseDocument> expenses = scopedExpenses(currentUser, false);
        List<BudgetDocument> budgets = firestoreGateway.listByField(FirestoreCollections.BUDGETS, "tenant_id", currentUser.tenantId(), BudgetDocument.class)
                .stream().filter(b -> currentUser.userId().equals(b.user_id)).collect(Collectors.toList());
        return Map.of(
                "exported_at", Instant.now().toString(),
                "user", me,
                "expenses", expenses,
                "budgets", budgets,
                "plans", firestoreGateway.listByField(FirestoreCollections.PLANS, "tenant_id", currentUser.tenantId(), Map.class),
                "payments", firestoreGateway.listByField(FirestoreCollections.PAYMENTS, "tenant_id", currentUser.tenantId(), Map.class)
        );
    }

    @DeleteMapping("/account")
    public Map<String, Object> deleteAccount(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser) {
        firestoreGateway.delete(FirestoreCollections.USERS, currentUser.userId());
        return Map.of("ok", true);
    }

    @GetMapping("/audit-trail")
    public List<Map<String, Object>> listAuditTrail(@org.springframework.security.core.annotation.AuthenticationPrincipal AuthUser currentUser,
                                                    @RequestParam(defaultValue = "100") int limit,
                                                    @RequestParam(defaultValue = "true") boolean allUsers) {
        List<Map> list = firestoreGateway.listByField(FirestoreCollections.AUDIT_EVENTS, "tenant_id", currentUser.tenantId(), Map.class);
        Stream<Map> stream = list.stream();
        if (!(allUsers && "admin".equals(currentUser.role()))) {
            stream = stream.filter(e -> Objects.equals(e.get("user_id"), currentUser.userId()));
        }
        return stream
                .sorted((a, b) -> String.valueOf(b.get("created_at")).compareTo(String.valueOf(a.get("created_at"))))
                .limit(Math.max(1, Math.min(limit, 500)))
                .map(e -> (Map<String, Object>) e)
                .collect(Collectors.toList());
    }

    private List<ExpenseDocument> scopedExpenses(AuthUser currentUser, boolean allUsers) {
        return firestoreGateway.listByField(FirestoreCollections.EXPENSES, "tenant_id", currentUser.tenantId(), ExpenseDocument.class)
                .stream()
                .filter(e -> (allUsers && "admin".equals(currentUser.role())) || currentUser.userId().equals(e.user_id))
                .collect(Collectors.toList());
    }

    private String safeMonth(String date) {
        if (date == null || date.length() < 7) return "0000-00";
        return date.substring(0, 7);
    }

    public static class SetBudgetRequest {
        public Double limit;
        public Double limit_value;
        @NotBlank public String month;
    }

    public static class UpsertCategoryBudgetRequest {
        public String budget_id;
        public String category_id;
        public String category_name;
        @NotBlank public String month;
        @NotNull public Double previsto;
        public Boolean imported_from_budget;
    }

    public static class ImportCategoryBudgetsRequest {
        @NotBlank public String month;
        @NotNull public List<Line> rows;
        public static class Line {
            public String categoria;
            @NotNull public Double previsto;
        }
    }

    public static class CopyRecurringBudgetRequest {
        @NotBlank public String targetMonth;
        public String sourceMonth;
        public Double adjustmentPercent;
    }

    public static class SetPrivacyConsentRequest {
        @NotNull public Boolean consent_marketing;
    }
}
