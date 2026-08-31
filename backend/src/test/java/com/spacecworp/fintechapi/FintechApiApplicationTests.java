package com.spacecworp.fintechapi;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.cloud.firestore.Firestore;
import com.spacecworp.fintechapi.auth.TenantDocument;
import com.spacecworp.fintechapi.expenses.CategoryDocument;
import com.spacecworp.fintechapi.expenses.ExpenseDocument;
import com.spacecworp.fintechapi.expenses.ExpenseRuleDocument;
import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.governance.AuditEventDocument;
import com.spacecworp.fintechapi.notifications.RegistrationEmailQueue;
import com.spacecworp.fintechapi.payments.PaymentDocument;
import com.spacecworp.fintechapi.plans.PlanSubscriptionDocument;
import com.spacecworp.fintechapi.users.UserDocument;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.util.*;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class FintechApiApplicationTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @MockBean
    Firestore firestore;

    @MockBean
    FirestoreGateway firestoreGateway;

    @MockBean
    RegistrationEmailQueue registrationEmailQueue;

    private final Map<String, Map<String, Object>> store = new HashMap<>();
    private final AtomicLong idSeq = new AtomicLong(1000);

    @BeforeEach
    void setUp() {
        store.clear();
        store.put(FirestoreCollections.TENANTS, new LinkedHashMap<>());
        store.put(FirestoreCollections.USERS, new LinkedHashMap<>());
        store.put(FirestoreCollections.CATEGORIES, new LinkedHashMap<>());
        store.put(FirestoreCollections.EXPENSES, new LinkedHashMap<>());
        store.put(FirestoreCollections.PLANS, new LinkedHashMap<>());
        store.put(FirestoreCollections.PAYMENTS, new LinkedHashMap<>());
        store.put(FirestoreCollections.EXPENSE_RULES, new LinkedHashMap<>());
        store.put(FirestoreCollections.AUDIT_EVENTS, new LinkedHashMap<>());

        seedBaseData();
        stubGateway();
    }

    @Test
    void contextLoads() {
    }

    @Test
    void signupTriggersRegistrationConfirmationEmail() throws Exception {
        String body = """
                {
                  "company_name":"Empresa X",
                  "admin_name":"Maria Souza",
                  "email":"maria@example.com",
                  "password":"senha123"
                }
                """;
        mockMvc.perform(post("/api/v1/auth/signup")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email").value("maria@example.com"));
        verify(registrationEmailQueue, times(1)).enqueue(any(UserDocument.class), any(TenantDocument.class));
    }

    @Test
    void apiContractValidationErrorEnvelope() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"\",\"password\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.timestamp").exists())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").exists())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.path").value("/api/v1/auth/login"));
    }

    @Test
    void prioritizedModulesIntegrationContracts() throws Exception {
        String token = loginAndGetToken("admin@example.com", "admin123");

        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.id").value("u1"))
                .andExpect(jsonPath("$.tenant.id").value("t1"));

        mockMvc.perform(get("/api/v1/users")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].email").value("admin@example.com"));

        mockMvc.perform(post("/api/v1/expense-rules")
                        .with(csrf())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"category_id\":\"c1\",\"keyword\":\"uber\",\"match_type\":\"contains\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").exists());

        mockMvc.perform(get("/api/v1/expenses/quota")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.plan").value("free"))
                .andExpect(jsonPath("$.used_today").exists());

        mockMvc.perform(get("/api/v1/plans")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.current_plan").value("free"));

        mockMvc.perform(get("/api/v1/payments/mercado-pago/status")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payments_verified_count").value(0));
    }

    @Test
    void fullFlowLoginExpensePlanPaymentAndConfirmation() throws Exception {
        String token = loginAndGetToken("admin@example.com", "admin123");

        String expenseBody = """
                {
                  "amount": 25.9,
                  "date": "2026-08-31",
                  "description": "Uber Centro",
                  "category_id": "c1",
                  "transaction_number": "TX-EXP-1"
                }
                """;
        mockMvc.perform(post("/api/v1/expenses")
                        .with(csrf())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(expenseBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").exists())
                .andExpect(jsonPath("$.amount").value(25.9));

        mockMvc.perform(post("/api/v1/plans/change")
                        .with(csrf())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"plan\":\"premium\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(jsonPath("$.plan").value("premium"));

        String paymentResp = mockMvc.perform(post("/api/v1/payments")
                        .with(csrf())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"plano\",\"plan\":\"premium\",\"amount\":19.99,\"txid\":\"PIX-001\",\"verifiedByAI\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").exists())
                .andExpect(jsonPath("$.type").value("plano"))
                .andReturn().getResponse().getContentAsString();
        String paymentId = objectMapper.readTree(paymentResp).path("id").asText();

        mockMvc.perform(post("/api/v1/payments/" + paymentId + "/confirm")
                        .with(csrf())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"verifiedByMercadoPago\":true,\"mercadoPagoPaymentId\":\"MP-123\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verifiedByMercadoPago").value(true))
                .andExpect(jsonPath("$.mercadoPagoPaymentId").value("MP-123"));

        mockMvc.perform(get("/api/v1/payments/mercado-pago/status")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connected").value(true))
                .andExpect(jsonPath("$.payments_verified_count").value(1));

        mockMvc.perform(post("/api/v1/payments/reconcile/mercado-pago")
                        .with(csrf())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"txid\":\"PIX-001\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(jsonPath("$.matched").value(true));

        List<?> audits = new ArrayList<>(store.get(FirestoreCollections.AUDIT_EVENTS).values());
        assertTrue(audits.size() >= 3);
        assertEquals("premium", ((PlanSubscriptionDocument) store.get(FirestoreCollections.PLANS).get("plan_t1")).plan);
    }

    @Test
    void nonAdminCannotEscalateAllUsersOnExpenseAndPaymentLists() throws Exception {
        String token = loginAndGetToken("member@example.com", "member123");

        ExpenseDocument adminExpense = new ExpenseDocument();
        adminExpense.id = "e-admin";
        adminExpense.tenant_id = "t1";
        adminExpense.user_id = "u1";
        adminExpense.amount = 100;
        adminExpense.date = "2026-08-30";
        adminExpense.description = "Admin expense";
        store.get(FirestoreCollections.EXPENSES).put(adminExpense.id, adminExpense);

        ExpenseDocument memberExpense = new ExpenseDocument();
        memberExpense.id = "e-member";
        memberExpense.tenant_id = "t1";
        memberExpense.user_id = "u2";
        memberExpense.amount = 50;
        memberExpense.date = "2026-08-31";
        memberExpense.description = "Member expense";
        store.get(FirestoreCollections.EXPENSES).put(memberExpense.id, memberExpense);

        PaymentDocument adminPayment = new PaymentDocument();
        adminPayment.id = "p-admin";
        adminPayment.tenant_id = "t1";
        adminPayment.user_id = "u1";
        adminPayment.type = "plano";
        adminPayment.amount = 19.99;
        adminPayment.date = "2026-08-31";
        store.get(FirestoreCollections.PAYMENTS).put(adminPayment.id, adminPayment);

        PaymentDocument memberPayment = new PaymentDocument();
        memberPayment.id = "p-member";
        memberPayment.tenant_id = "t1";
        memberPayment.user_id = "u2";
        memberPayment.type = "despesa";
        memberPayment.amount = 5;
        memberPayment.date = "2026-08-31";
        store.get(FirestoreCollections.PAYMENTS).put(memberPayment.id, memberPayment);

        mockMvc.perform(get("/api/v1/expenses?allUsers=true")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].user_id").value("u2"));

        mockMvc.perform(get("/api/v1/payments?allUsers=true")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].user_id").value("u2"));
    }

    @Test
    void idempotencyPreventsDuplicateFinancialWrites() throws Exception {
        String token = loginAndGetToken("admin@example.com", "admin123");

        String expensePayload = """
                {
                  "amount": 31.5,
                  "date": "2026-08-31",
                  "description": "Farmácia",
                  "category_id": "c1",
                  "transaction_number": "TX-IDEMP-1",
                  "idempotency_key": "idem-exp-001"
                }
                """;
        String expense1 = mockMvc.perform(post("/api/v1/expenses")
                        .with(csrf())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(expensePayload))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String expense2 = mockMvc.perform(post("/api/v1/expenses")
                        .with(csrf())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(expensePayload))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode e1 = objectMapper.readTree(expense1);
        JsonNode e2 = objectMapper.readTree(expense2);
        assertEquals(e1.path("id").asText(), e2.path("id").asText());

        String paymentPayload = """
                {
                  "type":"plano",
                  "plan":"premium",
                  "amount":19.99,
                  "txid":"TX-PAY-IDEMP-1",
                  "idempotency_key":"idem-pay-001"
                }
                """;
        String payment1 = mockMvc.perform(post("/api/v1/payments")
                        .with(csrf())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(paymentPayload))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String payment2 = mockMvc.perform(post("/api/v1/payments")
                        .with(csrf())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(paymentPayload))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode p1 = objectMapper.readTree(payment1);
        JsonNode p2 = objectMapper.readTree(payment2);
        assertEquals(p1.path("id").asText(), p2.path("id").asText());
    }

    private void seedBaseData() {
        TenantDocument tenant = new TenantDocument("t1", "Tenant One", "2026-08-01T00:00:00Z");
        tenant.plan = "free";
        store.get(FirestoreCollections.TENANTS).put(tenant.id, tenant);

        UserDocument admin = new UserDocument(
                "u1",
                "t1",
                "Admin",
                "admin@example.com",
                new BCryptPasswordEncoder().encode("admin123"),
                "admin",
                "2026-08-01T00:00:00Z"
        );
        admin.tax_document = "000.000.000-00";
        store.get(FirestoreCollections.USERS).put(admin.id, admin);

        UserDocument member = new UserDocument(
                "u2",
                "t1",
                "Member",
                "member@example.com",
                new BCryptPasswordEncoder().encode("member123"),
                "member",
                "2026-08-01T00:00:00Z"
        );
        store.get(FirestoreCollections.USERS).put(member.id, member);

        CategoryDocument category = new CategoryDocument("c1", "t1", "Transporte");
        store.get(FirestoreCollections.CATEGORIES).put(category.id, category);

        PlanSubscriptionDocument plan = new PlanSubscriptionDocument("plan_t1", "t1", "free", "2026-08-01T00:00:00Z");
        store.get(FirestoreCollections.PLANS).put(plan.id, plan);
    }

    private void stubGateway() {
        when(firestoreGateway.nextId(anyString())).thenAnswer(invocation -> {
            String collection = invocation.getArgument(0, String.class);
            return collection + "_" + idSeq.incrementAndGet();
        });

        doAnswer(invocation -> {
            String collection = invocation.getArgument(0, String.class);
            String id = invocation.getArgument(1, String.class);
            Object document = invocation.getArgument(2);
            store.get(collection).put(id, document);
            return null;
        }).when(firestoreGateway).save(anyString(), anyString(), any());

        doAnswer(invocation -> {
            String collection = invocation.getArgument(0, String.class);
            String id = invocation.getArgument(1, String.class);
            store.get(collection).remove(id);
            return null;
        }).when(firestoreGateway).delete(anyString(), anyString());

        when(firestoreGateway.findById(anyString(), anyString(), Mockito.<Class<Object>>any()))
                .thenAnswer(invocation -> {
                    String collection = invocation.getArgument(0, String.class);
                    String id = invocation.getArgument(1, String.class);
                    Class<?> type = invocation.getArgument(2, Class.class);
                    Object found = store.get(collection).get(id);
                    if (found == null || !type.isInstance(found)) return Optional.empty();
                    return Optional.of(found);
                });

        when(firestoreGateway.listByField(anyString(), anyString(), any(), Mockito.<Class<Object>>any()))
                .thenAnswer(invocation -> {
                    String collection = invocation.getArgument(0, String.class);
                    String field = invocation.getArgument(1, String.class);
                    Object value = invocation.getArgument(2);
                    Class<?> type = invocation.getArgument(3, Class.class);
                    List<Object> out = new ArrayList<>();
                    for (Object doc : store.get(collection).values()) {
                        if (!type.isInstance(doc)) continue;
                        Object fieldVal = readField(doc, field);
                        if (Objects.equals(fieldVal, value)) out.add(doc);
                    }
                    return out;
                });

        when(firestoreGateway.listByFields(anyString(), Mockito.<Map<String, Object>>any(), Mockito.<Class<Object>>any()))
                .thenAnswer(invocation -> {
                    String collection = invocation.getArgument(0, String.class);
                    Map<String, Object> filters = invocation.getArgument(1, Map.class);
                    Class<?> type = invocation.getArgument(2, Class.class);
                    List<Object> out = new ArrayList<>();
                    for (Object doc : store.get(collection).values()) {
                        if (!type.isInstance(doc)) continue;
                        boolean all = true;
                        for (Map.Entry<String, Object> e : filters.entrySet()) {
                            if (!Objects.equals(readField(doc, e.getKey()), e.getValue())) {
                                all = false;
                                break;
                            }
                        }
                        if (all) out.add(doc);
                    }
                    return out;
                });

        when(firestoreGateway.listAll(anyString(), Mockito.<Class<Object>>any()))
                .thenAnswer(invocation -> {
                    String collection = invocation.getArgument(0, String.class);
                    Class<?> type = invocation.getArgument(1, Class.class);
                    List<Object> out = new ArrayList<>();
                    for (Object doc : store.get(collection).values()) {
                        if (type.isInstance(doc)) out.add(doc);
                    }
                    return out;
                });

        when(firestoreGateway.listDocumentIds(anyString()))
                .thenAnswer(invocation -> {
                    String collection = invocation.getArgument(0, String.class);
                    return new ArrayList<>(store.get(collection).keySet());
                });
    }

    private Object readField(Object obj, String field) {
        try {
            return obj.getClass().getField(field).get(obj);
        } catch (Exception e) {
            return null;
        }
    }

    private String loginAndGetToken(String email, String password) throws Exception {
        String response = mockMvc.perform(post("/api/v1/auth/login")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").exists())
                .andReturn().getResponse().getContentAsString();

        JsonNode tokenNode = objectMapper.readTree(response).path("token");
        JsonNode parsed = objectMapper.readTree(tokenNode.asText());
        return parsed.path("access_token").asText();
    }
}
