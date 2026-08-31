package com.spacecworp.fintechapi.payments;

import com.spacecworp.fintechapi.common.ApiException;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.governance.AuditService;
import com.spacecworp.fintechapi.security.AuthUser;
import com.spacecworp.fintechapi.security.SecurityUtils;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/payments")
@Validated
public class PaymentController {
    private final FirestoreGateway firestore;
    private final AuditService auditService;

    public PaymentController(FirestoreGateway firestore, AuditService auditService) {
        this.firestore = firestore;
        this.auditService = auditService;
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

    public record ConfirmRequest(Boolean verifiedByMercadoPago, String mercadoPagoPaymentId, String txid) {}
    public record ReconcileRequest(String txid, String mercadoPagoPaymentId, String manualTxnNumber) {}

    @GetMapping
    public List<PaymentDocument> listPayments(
            @RequestParam(defaultValue = "false") boolean allUsers,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String month
    ) {
        AuthUser user = SecurityUtils.currentUser();
        List<PaymentDocument> tenantPayments = firestore.listByField(FirestoreCollections.PAYMENTS, "tenant_id", user.tenantId(), PaymentDocument.class);
        return tenantPayments.stream()
                .filter(p -> allUsers || user.userId().equals(p.user_id))
                .filter(p -> month == null || month.isBlank() || safe(p.date).startsWith(month))
                .filter(p -> from == null || from.isBlank() || safe(p.date).compareTo(from) >= 0)
                .filter(p -> to == null || to.isBlank() || safe(p.date).compareTo(to) <= 0)
                .toList();
    }

    @PostMapping
    public PaymentDocument addPayment(@Valid @RequestBody PaymentRequest req) {
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
        auditService.record(
                user,
                "payment.created",
                "payment",
                doc.id,
                "Pagamento registrado",
                Map.of(
                        "type", safe(doc.type),
                        "plan", safe(doc.plan),
                        "amount", doc.amount,
                        "txid", safe(doc.txid),
                        "verified_by_ai", Boolean.TRUE.equals(doc.verifiedByAI),
                        "verified_by_mercado_pago", Boolean.TRUE.equals(doc.verifiedByMercadoPago)
                )
        );
        return doc;
    }

    @PostMapping("/{id}/confirm")
    public PaymentDocument confirmPayment(@PathVariable String id, @RequestBody(required = false) ConfirmRequest req) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(user);
        PaymentDocument payment = firestore.findById(FirestoreCollections.PAYMENTS, id, PaymentDocument.class)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Pagamento não encontrado"));
        if (!user.tenantId().equals(payment.tenant_id)) throw new ApiException(HttpStatus.FORBIDDEN, "Acesso negado");

        payment.verifiedByMercadoPago = req == null || req.verifiedByMercadoPago() == null || req.verifiedByMercadoPago();
        if (req != null) {
            if (req.mercadoPagoPaymentId() != null && !req.mercadoPagoPaymentId().isBlank()) payment.mercadoPagoPaymentId = req.mercadoPagoPaymentId();
            if (req.txid() != null && !req.txid().isBlank()) payment.txid = req.txid();
        }
        firestore.save(FirestoreCollections.PAYMENTS, payment.id, payment);
        auditService.record(
                user,
                "payment.confirmed",
                "payment",
                payment.id,
                "Pagamento confirmado",
                Map.of(
                        "txid", safe(payment.txid),
                        "mercado_pago_payment_id", safe(payment.mercadoPagoPaymentId),
                        "verified_by_mercado_pago", Boolean.TRUE.equals(payment.verifiedByMercadoPago)
                )
        );
        return payment;
    }

    @PostMapping("/reconcile/mercado-pago")
    public Map<String, Object> reconcileMercadoPago(@RequestBody ReconcileRequest req) {
        AuthUser user = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin(user);
        if (req == null) throw new ApiException(HttpStatus.BAD_REQUEST, "Payload de reconciliação obrigatório");
        if (safe(req.txid()).isBlank() && safe(req.mercadoPagoPaymentId()).isBlank() && safe(req.manualTxnNumber()).isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Informe ao menos um identificador para reconciliação");
        }

        List<PaymentDocument> tenantPayments = firestore.listByField(FirestoreCollections.PAYMENTS, "tenant_id", user.tenantId(), PaymentDocument.class);
        PaymentDocument found = tenantPayments.stream().filter(p ->
                equalsIgnore(req.txid(), p.txid)
                        || equalsIgnore(req.mercadoPagoPaymentId(), p.mercadoPagoPaymentId)
                        || equalsIgnore(req.manualTxnNumber(), p.manualTxnNumber)
        ).findFirst().orElse(null);

        if (found == null) {
            auditService.record(
                    user,
                    "payment.reconcile.not_found",
                    "payment",
                    "-",
                    "Reconciliação sem correspondência",
                    Map.of(
                            "txid", safe(req.txid()),
                            "mercado_pago_payment_id", safe(req.mercadoPagoPaymentId()),
                            "manual_txn_number", safe(req.manualTxnNumber())
                    )
            );
            return Map.of("ok", false, "matched", false, "message", "Nenhum pagamento correspondente encontrado");
        }

        found.verifiedByMercadoPago = true;
        if (req.txid() != null && !req.txid().isBlank()) found.txid = req.txid();
        if (req.mercadoPagoPaymentId() != null && !req.mercadoPagoPaymentId().isBlank()) found.mercadoPagoPaymentId = req.mercadoPagoPaymentId();
        firestore.save(FirestoreCollections.PAYMENTS, found.id, found);
        auditService.record(
                user,
                "payment.reconciled",
                "payment",
                found.id,
                "Pagamento reconciliado com Mercado Pago",
                Map.of(
                        "txid", safe(found.txid),
                        "mercado_pago_payment_id", safe(found.mercadoPagoPaymentId),
                        "manual_txn_number", safe(req.manualTxnNumber())
                )
        );

        return Map.of("ok", true, "matched", true, "payment_id", found.id);
    }

    @GetMapping("/mercado-pago/status")
    public Map<String, Object> mercadoPagoStatus() {
        AuthUser user = SecurityUtils.currentUser();
        List<PaymentDocument> payments = firestore.listByField(FirestoreCollections.PAYMENTS, "tenant_id", user.tenantId(), PaymentDocument.class);

        long verified = payments.stream().filter(p -> Boolean.TRUE.equals(p.verifiedByMercadoPago)).count();
        long pending = payments.stream().filter(p -> !Boolean.TRUE.equals(p.verifiedByMercadoPago)).count();
        String lastConfirmedDate = payments.stream()
                .filter(p -> Boolean.TRUE.equals(p.verifiedByMercadoPago))
                .map(p -> p.date)
                .filter(d -> d != null && !d.isBlank())
                .max(Comparator.naturalOrder())
                .orElse(null);

        return Map.of(
                "connected", verified > 0,
                "payments_verified_count", verified,
                "payments_pending_count", pending,
                "last_confirmed_date", lastConfirmedDate
        );
    }

    @GetMapping("/reconciliation/status")
    public Map<String, Object> reconciliationStatus() {
        AuthUser user = SecurityUtils.currentUser();
        List<PaymentDocument> payments = firestore.listByField(FirestoreCollections.PAYMENTS, "tenant_id", user.tenantId(), PaymentDocument.class);
        long total = payments.size();
        long verifiedByMP = payments.stream().filter(p -> Boolean.TRUE.equals(p.verifiedByMercadoPago)).count();
        long verifiedByAI = payments.stream().filter(p -> Boolean.TRUE.equals(p.verifiedByAI)).count();
        long manual = payments.stream().filter(p -> !Boolean.TRUE.equals(p.verifiedByMercadoPago) && !Boolean.TRUE.equals(p.verifiedByAI)).count();
        return Map.of(
                "total", total,
                "verified_by_mercado_pago", verifiedByMP,
                "verified_by_ai", verifiedByAI,
                "manual_or_pending", manual
        );
    }

    private boolean equalsIgnore(String a, String b) {
        return safe(a).equalsIgnoreCase(safe(b)) && !safe(a).isBlank();
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }
}
