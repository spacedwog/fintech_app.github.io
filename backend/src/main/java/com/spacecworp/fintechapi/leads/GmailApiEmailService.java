package com.spacecworp.fintechapi.leads;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

@Service
public class GmailApiEmailService {
    private static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

    private final RestClient http = RestClient.create();
    private final String clientId;
    private final String clientSecret;
    private final String refreshToken;
    private final String sender;
    private final String salesInbox;

    public GmailApiEmailService(
            @Value("${app.google.gmail.client-id:}") String clientId,
            @Value("${app.google.gmail.client-secret:}") String clientSecret,
            @Value("${app.google.gmail.refresh-token:}") String refreshToken,
            @Value("${app.google.gmail.sender:}") String sender,
            @Value("${app.google.gmail.sales-inbox:}") String salesInbox) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.refreshToken = refreshToken;
        this.sender = sender;
        this.salesInbox = salesInbox;
    }

    public boolean isConfigured() {
        return !clientId.isBlank() && !clientSecret.isBlank() && !refreshToken.isBlank()
                && !sender.isBlank() && !salesInbox.isBlank();
    }

    public void sendLeadEmails(LeadRequest lead) {
        if (!isConfigured()) throw new IllegalStateException("Google Gmail API is not configured");
        String token = accessToken();
        String details = "Nome: " + clean(lead.name()) + "\nE-mail: " + lead.email()
                + "\nTelefone: " + clean(lead.phone()) + "\nMensagem: " + clean(lead.message());
        send(token, salesInbox, "Novo contato pelo site Spacecworp", details);
        send(token, lead.email(), "Recebemos seu contato — Spacecworp",
                "Olá, " + clean(lead.name()) + "!\n\nObrigado pelo interesse. Recebemos sua mensagem e nossa equipe entrará em contato em breve.\n\nSpacecworp");
    }

    private String accessToken() {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret);
        form.add("refresh_token", refreshToken);
        form.add("grant_type", "refresh_token");
        Map<?, ?> response = http.post().uri(TOKEN_URL)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form).retrieve().body(Map.class);
        Object token = response == null ? null : response.get("access_token");
        if (!(token instanceof String value) || value.isBlank()) {
            throw new IllegalStateException("Google OAuth did not return an access token");
        }
        return value;
    }

    private void send(String token, String recipient, String subject, String body) {
        String encodedBody = Base64.getMimeEncoder(76, "\r\n".getBytes(StandardCharsets.US_ASCII))
                .encodeToString(body.getBytes(StandardCharsets.UTF_8));
        String mime = "To: " + recipient + "\r\n"
                + "From: " + sender + "\r\n"
                + "Subject: " + subject + "\r\n"
                + "MIME-Version: 1.0\r\n"
                + "Content-Type: text/plain; charset=UTF-8\r\n"
                + "Content-Transfer-Encoding: base64\r\n\r\n"
                + encodedBody;
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(mime.getBytes(StandardCharsets.UTF_8));
        http.post().uri(SEND_URL)
                .headers(headers -> headers.setBearerAuth(token))
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("raw", raw))
                .retrieve().toBodilessEntity();
    }

    private String clean(String value) {
        return value == null ? "-" : value.replace("\r", " ").replace("\n", " ").trim();
    }
}
