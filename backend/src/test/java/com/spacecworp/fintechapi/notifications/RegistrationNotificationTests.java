package com.spacecworp.fintechapi.notifications;

import com.spacecworp.fintechapi.auth.TenantDocument;
import com.spacecworp.fintechapi.users.UserDocument;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class RegistrationNotificationTests {

    @Test
    void aiAgentGeneratesTextAndResponsiveHtml() {
        RegistrationEmailAiAgent agent = new RegistrationEmailAiAgent();
        UserDocument user = new UserDocument("u1", "t1", "Maria Souza", "maria@example.com", "x", "admin", "2026-08-31T00:00:00Z");
        TenantDocument tenant = new TenantDocument("t1", "Empresa X", "2026-08-31T00:00:00Z");

        RegistrationEmailAiAgent.EmailContent content = agent.compose(user, tenant);

        assertTrue(content.subject().contains("Cadastro confirmado"));
        assertTrue(content.text().contains("Maria"));
        assertTrue(content.html().contains("<meta name=\"viewport\""));
        assertTrue(content.html().contains("@media (max-width:640px)"));
        assertTrue(content.html().contains("maria@example.com"));
        assertTrue(content.html().contains("Empresa X"));
    }

    @Test
    void queueRetriesAndEventuallySends() throws Exception {
        RegistrationConfirmationEmailService service = Mockito.mock(RegistrationConfirmationEmailService.class);
        doThrow(new IllegalStateException("smtp down"))
                .doNothing()
                .when(service).sendRegistrationConfirmationNow(any(UserDocument.class), any(TenantDocument.class));

        RegistrationEmailQueue queue = new RegistrationEmailQueue(service, 3, 1);
        UserDocument user = new UserDocument("u1", "t1", "Maria Souza", "maria@example.com", "x", "admin", "2026-08-31T00:00:00Z");
        TenantDocument tenant = new TenantDocument("t1", "Empresa X", "2026-08-31T00:00:00Z");

        queue.enqueue(user, tenant);
        queue.processQueue();
        Thread.sleep(5);
        queue.processQueue();

        verify(service, times(2)).sendRegistrationConfirmationNow(any(UserDocument.class), any(TenantDocument.class));
        assertEquals(0, queue.queueSize());
    }

    @Test
    void queueStopsAfterMaxRetries() throws Exception {
        RegistrationConfirmationEmailService service = Mockito.mock(RegistrationConfirmationEmailService.class);
        doThrow(new IllegalStateException("smtp down")).when(service).sendRegistrationConfirmationNow(any(UserDocument.class), any(TenantDocument.class));

        RegistrationEmailQueue queue = new RegistrationEmailQueue(service, 2, 1);
        UserDocument user = new UserDocument("u1", "t1", "Maria Souza", "maria@example.com", "x", "admin", "2026-08-31T00:00:00Z");
        TenantDocument tenant = new TenantDocument("t1", "Empresa X", "2026-08-31T00:00:00Z");

        queue.enqueue(user, tenant);
        queue.processQueue();
        Thread.sleep(5);
        queue.processQueue();
        Thread.sleep(5);
        queue.processQueue();

        verify(service, atLeast(2)).sendRegistrationConfirmationNow(any(UserDocument.class), any(TenantDocument.class));
        assertEquals(0, queue.queueSize());
    }
}
