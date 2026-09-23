package com.spacecworp.fintechapi.firestore;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spacecworp.fintechapi.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Component
public class JdbcDocumentGateway implements DocumentGateway {
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public JdbcDocumentGateway(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public String nextId(String collection) {
        return UUID.randomUUID().toString();
    }

    @Override
    public <T> Optional<T> findById(String collection, String id, Class<T> type) {
        List<T> rows = jdbcTemplate.query(
                "select payload_json from app_document where collection_name = ? and document_id = ?",
                (rs, rowNum) -> deserialize(rs.getString("payload_json"), type),
                collection,
                id
        );
        return rows.stream().findFirst();
    }

    @Override
    public <T> void save(String collection, String id, T document) {
        String payload = serialize(document);
        int updated = jdbcTemplate.update(
                "update app_document set payload_json = ?, updated_at = current_timestamp where collection_name = ? and document_id = ?",
                payload,
                collection,
                id
        );
        if (updated == 0) {
            jdbcTemplate.update(
                    "insert into app_document (collection_name, document_id, payload_json, created_at, updated_at) values (?, ?, ?, current_timestamp, current_timestamp)",
                    collection,
                    id,
                    payload
            );
        }
    }

    @Override
    public void delete(String collection, String id) {
        jdbcTemplate.update(
                "delete from app_document where collection_name = ? and document_id = ?",
                collection,
                id
        );
    }

    @Override
    public <T> List<T> listByField(String collection, String field, Object value, Class<T> type) {
        return listByFields(collection, Map.of(field, value), type);
    }

    @Override
    public <T> List<T> listByFields(String collection, Map<String, Object> equalsFilters, Class<T> type) {
        List<T> rows = new ArrayList<>();
        jdbcTemplate.query(
                "select payload_json from app_document where collection_name = ? order by updated_at asc, document_id asc",
                rs -> {
                    String payload = rs.getString("payload_json");
                    JsonNode json = deserializeTree(payload);
                    if (matchesAll(json, equalsFilters)) {
                        rows.add(deserialize(payload, type));
                    }
                },
                collection
        );
        return rows;
    }

    @Override
    public <T> List<T> listAll(String collection, Class<T> type) {
        return jdbcTemplate.query(
                "select payload_json from app_document where collection_name = ? order by updated_at asc, document_id asc",
                (rs, rowNum) -> deserialize(rs.getString("payload_json"), type),
                collection
        );
    }

    @Override
    public List<String> listDocumentIds(String collection) {
        return jdbcTemplate.query(
                "select document_id from app_document where collection_name = ? order by updated_at asc, document_id asc",
                (rs, rowNum) -> rs.getString("document_id"),
                collection
        );
    }

    private boolean matchesAll(JsonNode json, Map<String, Object> equalsFilters) {
        for (Map.Entry<String, Object> entry : equalsFilters.entrySet()) {
            if (!matches(json.get(entry.getKey()), entry.getValue())) {
                return false;
            }
        }
        return true;
    }

    private boolean matches(JsonNode actual, Object expected) {
        if (expected == null) {
            return actual == null || actual.isNull();
        }
        if (actual == null || actual.isNull()) {
            return false;
        }
        if (expected instanceof Boolean expectedBoolean) {
            return actual.isBoolean() && actual.booleanValue() == expectedBoolean;
        }
        if (expected instanceof Number expectedNumber) {
            if (!actual.isNumber()) {
                return false;
            }
            return actual.decimalValue().compareTo(new BigDecimal(String.valueOf(expectedNumber))) == 0;
        }
        return String.valueOf(expected).equals(actual.asText());
    }

    private JsonNode deserializeTree(String payload) {
        try {
            return objectMapper.readTree(payload);
        } catch (JsonProcessingException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Falha ao ler documento persistido");
        }
    }

    private <T> T deserialize(String payload, Class<T> type) {
        try {
            return objectMapper.readValue(payload, type);
        } catch (JsonProcessingException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Falha ao desserializar documento persistido");
        }
    }

    private String serialize(Object document) {
        try {
            return objectMapper.writeValueAsString(document);
        } catch (JsonProcessingException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Falha ao serializar documento persistido");
        }
    }
}
