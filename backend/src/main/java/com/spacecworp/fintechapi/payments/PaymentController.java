package com.spacecworp.fintechapi.payments;

import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.SecurityUtils;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/payments")
public class PaymentController {
    private final FirestoreGateway firestore;

    public PaymentController(FirestoreGateway firestore) {
        this.firestore = firestore;
    }

    public record PaymentRequest(
            @NotBlank String type,
            String plan,
            @DecimalMin(value = "0.01") double amount,
            String txid,
            Boolean verifiedByAI,
            String aiClassification,
            Boolean verifiedByMercadoPago,
            String manualTxnNumber,
            String mercadoPagoPaymentId
    ) {}

    @GetMapping
    public List<PaymentDocument> listPayments(@RequestParam(defaultValue = "false") boolean allUsers) {
        AuthUser user = SecurityUtils.currentUser();
        List<PaymentDocument> tenantPayments = firestore.listByField(FirestoreCollections.PAYMENTS, "tenant_id", user.tenantId(), PaymentDocument.class);
        if (allUsers) return tenantPayments;
        return tenantPayments.stream().filter(p -> user.userId().equals(p.user_id)).toList();
    }

    @PostMapping
    public PaymentDocument addPayment(@RequestBody PaymentRequest req) {
        AuthUser user = SecurityUtils.currentUser();
        String id = firestore.nextId(FirestoreCollections.PAYMENTS);
        PaymentDocument doc = new PaymentDocument();
        doc.id = id;
        doc.tenant_id = user.tenantId();
        doc.user_id = user.userId();
        doc.type = req.type();
        doc.plan = req.plan();
        doc.amount = req.amount();
        doc.txid = req.txid();
        doc.date = LocalDate.now().toString();
        doc.verifiedByAI = req.verifiedByAI();
        doc.aiClassification = req.aiClassification();
        doc.verifiedByMercadoPago = req.verifiedByMercadoPago();
        doc.manualTxnNumber = req.manualTxnNumber();
        doc.mercadoPagoPaymentId = req.mercadoPagoPaymentId();
        firestore.save(FirestoreCollections.PAYMENTS, id, doc);
        return doc;
    }

    @GetMapping("/mercado-pago/status")
    public Map<String, Object> mercadoPagoStatus() {
        AuthUser user = SecurityUtils.currentUser();
        List<PaymentDocument> payments = firestore.listByField(FirestoreCollections.PAYMENTS, "tenant_id", user.tenantId(), PaymentDocument.class);
        long verified = payments.stream().filter(p -> Boolean.TRUE.equals(p.verifiedByMercadoPago)).count();
        return Map.of("connected", verified > 0, "payments_verified_count", verified);
    }
}
