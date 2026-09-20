package com.spacecworp.fintechapi.cloudengine.infrastructure.jdbc;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public final class CloudEngineProcedures {
    private CloudEngineProcedures() {
    }

    public static String closeBudgetCycle(Connection connection, Long budgetCycleId, String closedBy) throws SQLException {
        try (PreparedStatement update = connection.prepareStatement("""
                update ce_budget_cycle
                   set status = 'CLOSED',
                       closed_at = current_timestamp,
                       closed_by = ?
                 where id = ?
                """)) {
            update.setString(1, closedBy == null || closedBy.isBlank() ? "cloud-engine" : closedBy);
            update.setLong(2, budgetCycleId);
            update.executeUpdate();
        }
        try (PreparedStatement audit = connection.prepareStatement("""
                insert into ce_audit_log (company_id, entity_type, entity_id, action, detail, created_at)
                select company_id, 'ce_budget_cycle', cast(id as varchar), 'CLOSED', 'Fechamento via procedure ERP_CLOSE_BUDGET_CYCLE', current_timestamp
                  from ce_budget_cycle
                 where id = ?
                """)) {
            audit.setLong(1, budgetCycleId);
            audit.executeUpdate();
        }
        return "CLOSED";
    }

    public static Long registerAgentJob(Connection connection, Long companyId, String agentType, String payloadJson) throws SQLException {
        try (PreparedStatement insert = connection.prepareStatement("""
                insert into ce_agent_job (company_id, agent_type, payload_json, status, requested_at)
                values (?, ?, ?, 'QUEUED', current_timestamp)
                """, PreparedStatement.RETURN_GENERATED_KEYS)) {
            insert.setLong(1, companyId);
            insert.setString(2, agentType);
            insert.setString(3, payloadJson);
            insert.executeUpdate();
            try (ResultSet generatedKeys = insert.getGeneratedKeys()) {
                if (generatedKeys.next()) return generatedKeys.getLong(1);
            }
        }
        return null;
    }
}
