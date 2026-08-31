package com.spacecworp.fintechapi.migration;

import com.spacecworp.fintechapi.auth.TenantDocument;
import com.spacecworp.fintechapi.expenses.CategoryDocument;
import com.spacecworp.fintechapi.expenses.ExpenseDocument;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.payments.PaymentDocument;
import com.spacecworp.fintechapi.plans.PlanSubscriptionDocument;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.SecurityUtils;
import com.spacecworp.fintechapi.users.UserDocument;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

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
            List<PaymentDocument> payments
    ) {}

    @PostMapping("/import")
    public Map<String, Object> importData(@RequestBody ImportPayload payload) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(user);

        int imported = 0;
        imported += importList(FirestoreCollections.TENANTS, payload.tenants(), x -> x.id);
        imported += importList(FirestoreCollections.USERS, payload.users(), x -> x.id);
        imported += importList(FirestoreCollections.CATEGORIES, payload.categories(), x -> x.id);
        imported += importList(FirestoreCollections.EXPENSES, payload.expenses(), x -> x.id);
        imported += importList(FirestoreCollections.PLANS, payload.plans(), x -> x.id);
        imported += importList(FirestoreCollections.PAYMENTS, payload.payments(), x -> x.id);

        return Map.of("ok", true, "imported", imported);
    }

    private <T> int importList(String collection, List<T> items, java.util.function.Function<T, String> idFn) {
        if (items == null) return 0;
        for (T item : items) firestore.save(collection, idFn.apply(item), item);
        return items.size();
    }
}
