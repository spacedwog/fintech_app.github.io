package com.spacecworp.fintechapi.cloudengine.domain.model;

public final class PaymentModule extends CloudEngineModule {
    public PaymentModule() {
        super("payment", "Pagamentos ERP", "Recebimentos, liquidação, trilha financeira e reconciliação operacional.", "amber");
    }

    @Override
    public String capability() {
        return "liquidação";
    }
}
