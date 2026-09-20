package com.spacecworp.fintechapi.cloudengine.domain.model;

public final class BudgetModule extends CloudEngineModule {
    public BudgetModule() {
        super("budget", "Orçamento ERP", "Planejamento, ciclos orçamentários e execução por centro de custo.", "cyan");
    }

    @Override
    public String capability() {
        return "planejamento";
    }
}
