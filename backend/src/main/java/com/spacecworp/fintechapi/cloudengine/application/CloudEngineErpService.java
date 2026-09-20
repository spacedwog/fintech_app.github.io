package com.spacecworp.fintechapi.cloudengine.application;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.Map;

@Service
public class CloudEngineErpService {
    private final JdbcClient jdbcClient;

    public CloudEngineErpService(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public ErpOverview loadOverview() {
        return loadOverview(YearMonth.now());
    }

    public ErpOverview loadOverview(YearMonth month) {
        var monthStart = month.atDay(1);
        var nextMonthStart = month.plusMonths(1).atDay(1);

        Map<String, Object> budgetExecution = jdbcClient.sql("""
                select coalesce(sum(planned_amount), 0) as planned_amount,
                       coalesce(sum(executed_amount), 0) as executed_amount,
                       coalesce(sum(remaining_amount), 0) as remaining_amount
                  from ce_v_budget_execution
                 where reference_month = :referenceMonth
                """)
                .param("referenceMonth", monthStart)
                .query()
                .singleRow();

        Map<String, Object> paymentSummary = jdbcClient.sql("""
                select coalesce(sum(total_amount), 0) as total_amount,
                       coalesce(sum(paid_amount), 0) as paid_amount,
                       coalesce(sum(pending_amount), 0) as pending_amount
                  from ce_v_payment_summary
                 where reference_month = :referenceMonth
                """)
                .param("referenceMonth", monthStart)
                .query()
                .singleRow();

        Integer queuedAgents = jdbcClient.sql("""
                select count(*)
                  from ce_agent_job
                 where status in ('QUEUED', 'RUNNING')
                   and company_id in (
                       select distinct company_id
                         from ce_v_budget_execution
                        where reference_month = :referenceMonth
                   )
                   and requested_at >= :monthStart
                   and requested_at < :nextMonthStart
                """)
                .param("referenceMonth", monthStart)
                .param("monthStart", monthStart.atStartOfDay())
                .param("nextMonthStart", nextMonthStart.atStartOfDay())
                .query(Integer.class)
                .single();

        return new ErpOverview(
                month.toString(),
                decimal(budgetExecution.get("planned_amount")),
                decimal(budgetExecution.get("executed_amount")),
                decimal(budgetExecution.get("remaining_amount")),
                decimal(paymentSummary.get("total_amount")),
                decimal(paymentSummary.get("paid_amount")),
                decimal(paymentSummary.get("pending_amount")),
                queuedAgents == null ? 0 : queuedAgents
        );
    }

    private BigDecimal decimal(Object value) {
        if (value instanceof BigDecimal number) return number;
        if (value == null) return BigDecimal.ZERO;
        return new BigDecimal(String.valueOf(value));
    }

    public record ErpOverview(
            String referenceMonth,
            BigDecimal plannedBudget,
            BigDecimal executedBudget,
            BigDecimal remainingBudget,
            BigDecimal paymentTotal,
            BigDecimal paymentPaid,
            BigDecimal paymentPending,
            int queuedAgents
    ) {}
}
