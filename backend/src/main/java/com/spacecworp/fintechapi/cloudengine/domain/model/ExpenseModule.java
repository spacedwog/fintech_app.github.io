package com.spacecworp.fintechapi.cloudengine.domain.model;

public final class ExpenseModule extends CloudEngineModule {
    public ExpenseModule() {
        super("expense", "Gastos ERP", "Lançamentos normalizados, status operacionais e conciliação de despesas.", "emerald");
    }

    @Override
    public String capability() {
        return "execução";
    }
}
