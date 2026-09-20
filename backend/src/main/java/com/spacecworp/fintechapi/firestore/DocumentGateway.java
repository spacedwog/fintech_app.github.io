package com.spacecworp.fintechapi.firestore;

import java.util.List;
import java.util.Map;
import java.util.Optional;

public interface DocumentGateway {
    String nextId(String collection);

    <T> Optional<T> findById(String collection, String id, Class<T> type);

    <T> void save(String collection, String id, T document);

    void delete(String collection, String id);

    <T> List<T> listByField(String collection, String field, Object value, Class<T> type);

    <T> List<T> listByFields(String collection, Map<String, Object> equalsFilters, Class<T> type);

    <T> List<T> listAll(String collection, Class<T> type);

    List<String> listDocumentIds(String collection);
}
