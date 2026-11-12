package com.spacecworp.fintechapi.leads;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/leads")
public class LeadController {
    private static final Logger log = LoggerFactory.getLogger(LeadController.class);
    private final LeadRepository leadRepository;
    private final LeadRateLimiter rateLimiter;

    public LeadController(LeadRepository leadRepository, LeadRateLimiter rateLimiter) {
        this.leadRepository = leadRepository;
        this.rateLimiter = rateLimiter;
    }

    @PostMapping
    public ResponseEntity<Map<String, String>> capture(@Valid @RequestBody LeadRequest lead, HttpServletRequest request) {
        // Honeypot: silently accept automated form submissions without storing contact data.
        if (lead.website() != null && !lead.website().isBlank()) {
            return ResponseEntity.accepted().body(Map.of("message", "Contato recebido."));
        }
        if (!rateLimiter.allow(request.getRemoteAddr())) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("message", "Muitas tentativas. Tente novamente mais tarde."));
        }
        try {
            leadRepository.save(lead);
            return ResponseEntity.status(HttpStatus.CREATED)
                    .body(Map.of("message", "Contato registrado. Nossa equipe retornará em breve."));
        } catch (RuntimeException exception) {
            log.warn("Falha ao registrar solicitação de contato");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("message", "Não foi possível registrar agora. Tente novamente mais tarde."));
        }
    }
}
