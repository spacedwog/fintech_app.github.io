package com.spacecworp.fintechapi.cloudengine.domain.model;

public final class AgentModule extends CloudEngineModule {
    public AgentModule() {
        super("agents", "Agentes Java", "Fila de agentes, OCR, reconciliação e integrações migradas para o núcleo Java.", "violet");
    }

    @Override
    public String capability() {
        return "orquestração";
    }
}
