package com.spacecworp.fintechapi.cloudengine.infrastructure.jdbc;

import org.h2.api.Trigger;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

public class CloudEngineAuditTrigger implements Trigger {
    private String tableName;

    @Override
    public void init(Connection conn, String schemaName, String triggerName, String tableName, boolean before, int type) {
        this.tableName = tableName;
    }

    @Override
    public void fire(Connection conn, Object[] oldRow, Object[] newRow) throws SQLException {
        Object[] row = newRow != null ? newRow : oldRow;
        if (row == null) return;
        Long entityId = asLong(row[0]);
        Long companyId = asLong(row[1]);
        String action = oldRow == null ? "CREATED" : newRow == null ? "DELETED" : "UPDATED";
        try (PreparedStatement statement = conn.prepareStatement("""
                insert into ce_audit_log (company_id, entity_type, entity_id, action, detail, created_at)
                values (?, ?, ?, ?, ?, current_timestamp)
                """)) {
            statement.setLong(1, companyId == null ? 0L : companyId);
            statement.setString(2, tableName);
            statement.setString(3, entityId == null ? null : String.valueOf(entityId));
            statement.setString(4, action);
            statement.setString(5, "Trigger de auditoria do Cloud Engine");
            statement.executeUpdate();
        }
    }

    private Long asLong(Object value) {
        if (value instanceof Number number) return number.longValue();
        if (value == null) return null;
        return Long.valueOf(String.valueOf(value));
    }

    @Override
    public void close() {
    }

    @Override
    public void remove() {
    }
}
