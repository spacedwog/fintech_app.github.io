package com.spacecworp.fintechapi.plans;

import java.util.List;

public final class PlanCatalog {
    private PlanCatalog() {}

    public record PlanDto(String code, String name, double monthly_price, int daily_expense_limit, double overage_price) {}

    public static final List<PlanDto> ALL = List.of(
            new PlanDto("free", "Free", 0.0, 6, 5.0),
            new PlanDto("premium", "Premium", 19.99, Integer.MAX_VALUE, 0.0)
    );

    public static PlanDto find(String code) {
        return ALL.stream().filter(p -> p.code().equalsIgnoreCase(code)).findFirst().orElse(null);
    }
}
