package com.spacecworp.fintechapi.notifications;

import com.spacecworp.fintechapi.auth.TenantDocument;
import com.spacecworp.fintechapi.users.UserDocument;
import org.springframework.stereotype.Component;

import java.time.LocalDate;

@Component
public class RegistrationEmailAiAgent {

    public EmailContent compose(UserDocument user, TenantDocument tenant) {
        String company = safe(tenant == null ? null : tenant.name, "sua conta");
        String firstName = extractFirstName(user == null ? null : user.name);
        String subject = "Cadastro confirmado • " + company;
        String text = "Olá " + firstName + ",\n\n"
                + "Seu cadastro foi confirmado com sucesso no Fintech Spacecworp.\n"
                + "Conta: " + company + "\n"
                + "E-mail: " + safe(user == null ? null : user.email, "-") + "\n"
                + "Data: " + LocalDate.now() + "\n\n"
                + "Você já pode acessar e começar a gerenciar suas despesas pessoais com segurança.\n\n"
                + "Equipe Fintech Spacecworp";
        return new EmailContent(subject, text);
    }

    private String extractFirstName(String fullName) {
        String name = safe(fullName, "cliente").trim();
        int idx = name.indexOf(' ');
        return idx > 0 ? name.substring(0, idx) : name;
    }

    private String safe(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    public record EmailContent(String subject, String text) {}
}
