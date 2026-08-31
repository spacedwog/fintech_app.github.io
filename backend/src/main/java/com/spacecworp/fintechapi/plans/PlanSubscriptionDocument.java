package com.spacecworp.fintechapi.plans;

public class PlanSubscriptionDocument {
    public String id;
    public String tenant_id;
    public String plan;
    public String updated_at;

    public PlanSubscriptionDocument() {}

    public PlanSubscriptionDocument(String id, String tenant_id, String plan, String updated_at) {
        this.id = id;
        this.tenant_id = tenant_id;
        this.plan = plan;
        this.updated_at = updated_at;
    }
}
