package com.spacecworp.fintechapi.cloudengine.domain.model;

public abstract class CloudEngineModule {
    private final String code;
    private final String title;
    private final String description;
    private final String visualTone;

    protected CloudEngineModule(String code, String title, String description, String visualTone) {
        this.code = code;
        this.title = title;
        this.description = description;
        this.visualTone = visualTone;
    }

    public final String code() {
        return code;
    }

    public final String title() {
        return title;
    }

    public final String description() {
        return description;
    }

    public final String visualTone() {
        return visualTone;
    }

    public String badge() {
        return badge(capability());
    }

    public String badge(String suffix) {
        return title + " • " + suffix;
    }

    public abstract String capability();
}
