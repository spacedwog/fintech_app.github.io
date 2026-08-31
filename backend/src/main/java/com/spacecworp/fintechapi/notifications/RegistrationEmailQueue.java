package com.spacecworp.fintechapi.notifications;

import com.spacecworp.fintechapi.auth.TenantDocument;
import com.spacecworp.fintechapi.users.UserDocument;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;

@Component
public class RegistrationEmailQueue {
    private static final Logger log = LoggerFactory.getLogger(RegistrationEmailQueue.class);

    private final Queue<PendingEmail> queue = new ConcurrentLinkedQueue<>();
    private final RegistrationConfirmationEmailService sender;
    private final int maxRetries;
    private final long baseDelayMs;

    public RegistrationEmailQueue(
            RegistrationConfirmationEmailService sender,
            @Value("${app.notifications.registration-email.retry.max-attempts:3}") int maxRetries,
            @Value("${app.notifications.registration-email.retry.base-delay-ms:2000}") long baseDelayMs
    ) {
        this.sender = sender;
        this.maxRetries = Math.max(1, maxRetries);
        this.baseDelayMs = Math.max(1L, baseDelayMs);
    }

    public void enqueue(UserDocument user, TenantDocument tenant) {
        if (user == null || user.email == null || user.email.isBlank()) return;
        if (queue.stream().anyMatch(e -> Objects.equals(e.userId, user.id) && Objects.equals(e.email, user.email))) {
            return;
        }
        queue.offer(new PendingEmail(user, tenant));
        log.info("event=registration_email_enqueued user_id={} tenant_id={} email={}", user.id, user.tenant_id, user.email);
    }

    @Scheduled(fixedDelayString = "${app.notifications.registration-email.queue.poll-ms:1500}")
    public void processQueue() {
        if (queue.isEmpty()) return;
        Instant now = Instant.now();
        List<PendingEmail> snapshot = new ArrayList<>(queue);
        for (PendingEmail current : snapshot) {
            if (current.nextAttemptAt.isAfter(now)) continue;
            try {
                sender.sendRegistrationConfirmationNow(current.user, current.tenant);
                queue.remove(current);
            } catch (Exception ex) {
                current.attempts++;
                if (current.attempts >= maxRetries) {
                    log.warn("event=registration_email_give_up user_id={} tenant_id={} email={} attempts={} error={}",
                            current.userId, current.tenantId, current.email, current.attempts, ex.getMessage());
                    queue.remove(current);
                } else {
                    long delay = baseDelayMs * (1L << Math.max(0, current.attempts - 1));
                    current.nextAttemptAt = Instant.now().plus(Duration.ofMillis(delay));
                    log.warn("event=registration_email_retry_scheduled user_id={} tenant_id={} email={} attempts={} next_in_ms={} error={}",
                            current.userId, current.tenantId, current.email, current.attempts, delay, ex.getMessage());
                }
            }
        }
    }

    int queueSize() {
        return queue.size();
    }

    static class PendingEmail {
        final UserDocument user;
        final TenantDocument tenant;
        final String userId;
        final String tenantId;
        final String email;
        int attempts;
        Instant nextAttemptAt;

        PendingEmail(UserDocument user, TenantDocument tenant) {
            this.user = user;
            this.tenant = tenant;
            this.userId = user.id;
            this.tenantId = user.tenant_id;
            this.email = user.email;
            this.attempts = 0;
            this.nextAttemptAt = Instant.now();
        }
    }
}
