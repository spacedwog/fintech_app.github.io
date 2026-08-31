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
        String html = """
                <!doctype html>
                <html lang="pt-BR">
                  <head>
                    <meta charset="UTF-8" />
                    <meta name="viewport" content="width=device-width,initial-scale=1" />
                    <style>
                      body{margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;color:#111827}
                      .wrap{width:100%%;padding:24px 12px}
                      .card{max-width:620px;margin:0 auto;background:#ffffff;border-radius:14px;padding:24px;border:1px solid #e5e7eb}
                      .title{font-size:22px;font-weight:700;margin:0 0 12px}
                      .muted{color:#4b5563;font-size:14px}
                      .pill{display:inline-block;background:#2563eb;color:#fff;padding:8px 12px;border-radius:999px;font-size:13px;font-weight:600}
                      .kv{margin:16px 0;padding:12px;background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb}
                      .kv p{margin:6px 0;font-size:14px}
                      .cta{display:inline-block;margin-top:12px;background:#16a34a;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:600}
                      @media (max-width:640px){.card{padding:18px}.title{font-size:20px}}
                    </style>
                  </head>
                  <body>
                    <div class="wrap">
                      <div class="card">
                        <span class="pill">Cadastro confirmado</span>
                        <h1 class="title">Olá %s, sua conta está pronta!</h1>
                        <p class="muted">Seu cadastro foi confirmado com sucesso no Fintech Spacecworp.</p>
                        <div class="kv">
                          <p><strong>Conta:</strong> %s</p>
                          <p><strong>E-mail:</strong> %s</p>
                          <p><strong>Data:</strong> %s</p>
                        </div>
                        <p class="muted">Agora você já pode acessar e começar a gerenciar suas despesas pessoais com segurança.</p>
                        <a class="cta" href="https://spacedwog.github.io/fintech_app.github.io/login.html">Acessar plataforma</a>
                      </div>
                    </div>
                  </body>
                </html>
                """.formatted(
                escapeHtml(firstName),
                escapeHtml(company),
                escapeHtml(safe(user == null ? null : user.email, "-")),
                LocalDate.now()
        );
        return new EmailContent(subject, text, html);
    }

    private String extractFirstName(String fullName) {
        String name = safe(fullName, "cliente").trim();
        int idx = name.indexOf(' ');
        return idx > 0 ? name.substring(0, idx) : name;
    }

    private String safe(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private String escapeHtml(String value) {
        return safe(value, "")
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    public record EmailContent(String subject, String text, String html) {}
}
