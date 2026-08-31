package com.spacecworp.fintechapi.governance;

import com.spacecworp.fintechapi.firestore.FirestoreCollections;
import com.spacecworp.fintechapi.firestore.FirestoreGateway;
import com.spacecworp.fintechapi.security.AuthUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.Map;

@Service
public class AuditService {
    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    private final FirestoreGateway firestore;

    public AuditService(FirestoreGateway firestore) {
        this.firestore = firestore;
    }

    public void record(AuthUser actor, String action, String entity, String entityId, String message, Map<String, Object> metadata) {
        AuditEventDocument event = new AuditEventDocument();
        event.id = firestore.nextId(FirestoreCollections.AUDIT_EVENTS);
        event.tenant_id = actor.tenantId();
        event.user_id = actor.userId();
        event.action = action;
        event.entity = entity;
        event.entity_id = entityId;
        event.message = message;
        event.created_at = OffsetDateTime.now().toString();
        event.metadata = metadata == null ? Map.of() : metadata;

        firestore.save(FirestoreCollections.AUDIT_EVENTS, event.id, event);

        log.info(
                "event=audit action={} entity={} entity_id={} tenant_id={} user_id={} metadata={}",
                action,
                entity,
                entityId,
                actor.tenantId(),
                actor.userId(),
                event.metadata
        );
    }
}
