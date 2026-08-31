package com.spacecworp.fintechapi.notifications;

import com.spacecworp.fintechapi.auth.TenantDocument;
import com.spacecworp.fintechapi.users.UserDocument;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import jakarta.mail.internet.MimeMessage;

@Service
public class RegistrationConfirmationEmailService {
    private static final Logger log = LoggerFactory.getLogger(RegistrationConfirmationEmailService.class);

    private final ObjectProvider<JavaMailSender> mailSenderProvider;
    private final RegistrationEmailAiAgent aiAgent;
    private final String fromAddress;
    private final boolean enabled;

    public RegistrationConfirmationEmailService(
            ObjectProvider<JavaMailSender> mailSenderProvider,
            RegistrationEmailAiAgent aiAgent,
            @Value("${app.notifications.registration-email.from:no-reply@spacecworp.com}") String fromAddress,
            @Value("${app.notifications.registration-email.enabled:true}") boolean enabled
    ) {
        this.mailSenderProvider = mailSenderProvider;
        this.aiAgent = aiAgent;
        this.fromAddress = fromAddress;
        this.enabled = enabled;
    }

    public void sendRegistrationConfirmationNow(UserDocument user, TenantDocument tenant) {
        if (user == null || user.email == null || user.email.isBlank()) return;
        RegistrationEmailAiAgent.EmailContent content = aiAgent.compose(user, tenant);

        if (!enabled) {
            log.info("event=registration_email_skipped reason=disabled user_id={} tenant_id={} email={}", user.id, user.tenant_id, user.email);
            return;
        }

        JavaMailSender sender = mailSenderProvider.getIfAvailable();
        if (sender == null) {
            log.warn("event=registration_email_skipped reason=mail_sender_unavailable user_id={} tenant_id={} email={}", user.id, user.tenant_id, user.email);
            return;
        }

        try {            
            MimeMessage message = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(fromAddress);
            helper.setTo(user.email);
            helper.setSubject(content.subject());
            helper.setText(content.text(), content.html());
            sender.send(message);
            log.info("event=registration_email_sent user_id={} tenant_id={} email={}", user.id, user.tenant_id, user.email);
        } catch (Exception ex) {
            throw new IllegalStateException("Falha ao enviar e-mail de cadastro: " + ex.getMessage(), ex);
        }
    }
}
