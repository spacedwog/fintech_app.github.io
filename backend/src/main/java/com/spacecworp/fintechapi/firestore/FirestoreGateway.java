package com.spacecworp.fintechapi.firestore;

import com.google.api.core.ApiFuture;
import com.google.cloud.firestore.*;
import com.spacecworp.fintechapi.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ExecutionException;

@Component
public class FirestoreGateway {
    private final Firestore firestore;

    public FirestoreGateway(Firestore firestore) {
        this.firestore = firestore;
    }

    public String nextId(String collection) {
        return firestore.collection(collection).document().getId();
    }

    public <T> Optional<T> findById(String collection, String id, Class<T> type) {
        try {
            DocumentSnapshot snapshot = firestore.collection(collection).document(id).get().get();
            if (!snapshot.exists()) return Optional.empty();
            return Optional.ofNullable(snapshot.toObject(type));
        } catch (InterruptedException | ExecutionException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Falha de leitura no Firestore");
        }
    }

    public <T> void save(String collection, String id, T document) {
        try {
            firestore.collection(collection).document(id).set(document).get();
        } catch (InterruptedException | ExecutionException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Falha de escrita no Firestore");
        }
    }

    public void delete(String collection, String id) {
        try {
            firestore.collection(collection).document(id).delete().get();
        } catch (InterruptedException | ExecutionException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Falha ao excluir no Firestore");
        }
    }

    public <T> List<T> listByField(String collection, String field, Object value, Class<T> type) {
        try {
            ApiFuture<QuerySnapshot> q = firestore.collection(collection).whereEqualTo(field, value).get();
            List<QueryDocumentSnapshot> docs = q.get().getDocuments();
            List<T> out = new ArrayList<>(docs.size());
            for (QueryDocumentSnapshot doc : docs) out.add(doc.toObject(type));
            return out;
        } catch (InterruptedException | ExecutionException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Falha de consulta no Firestore");
        }
    }

    public <T> List<T> listByFields(String collection, Map<String, Object> equalsFilters, Class<T> type) {
        try {
            Query query = firestore.collection(collection);
            for (Map.Entry<String, Object> e : equalsFilters.entrySet()) {
                query = query.whereEqualTo(e.getKey(), e.getValue());
            }
            List<QueryDocumentSnapshot> docs = query.get().get().getDocuments();
            List<T> out = new ArrayList<>(docs.size());
            for (QueryDocumentSnapshot doc : docs) out.add(doc.toObject(type));
            return out;
        } catch (InterruptedException | ExecutionException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Falha de consulta no Firestore");
        }
    }

    public <T> List<T> listAll(String collection, Class<T> type) {
        try {
            List<QueryDocumentSnapshot> docs = firestore.collection(collection).get().get().getDocuments();
            List<T> out = new ArrayList<>(docs.size());
            for (QueryDocumentSnapshot doc : docs) out.add(doc.toObject(type));
            return out;
        } catch (InterruptedException | ExecutionException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Falha de listagem no Firestore");
        }
    }

    public List<String> listDocumentIds(String collection) {
        try {
            List<QueryDocumentSnapshot> docs = firestore.collection(collection).get().get().getDocuments();
            List<String> out = new ArrayList<>(docs.size());
            for (QueryDocumentSnapshot doc : docs) out.add(doc.getId());
            return out;
        } catch (InterruptedException | ExecutionException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Falha de listagem no Firestore");
        }
    }
}
