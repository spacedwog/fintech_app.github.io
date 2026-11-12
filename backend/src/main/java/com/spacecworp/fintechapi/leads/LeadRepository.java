package com.spacecworp.fintechapi.leads;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class LeadRepository {
    private final JdbcTemplate jdbcTemplate;

    public LeadRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void save(LeadRequest lead) {
        Timestamp createdAt = Timestamp.from(Instant.now());
        jdbcTemplate.update("""
                insert into leads (id, name, email, phone, message, consent, consented_at, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                UUID.randomUUID().toString(), lead.name().trim(), lead.email().trim().toLowerCase(),
                normalize(lead.phone()), normalize(lead.message()), lead.consent(), createdAt, createdAt);
    }

    private String normalize(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
