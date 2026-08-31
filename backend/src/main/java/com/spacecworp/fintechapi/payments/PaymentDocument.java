package com.spacecworp.fintechapi.payments;

public class PaymentDocument {
    public String id;
    public String tenant_id;
    public String user_id;
    public String type;
    public String plan;
    public double amount;
    public String date;
    public String txid;
    public Boolean verifiedByAI;
    public String aiClassification;
    public Boolean verifiedByMercadoPago;
    public String manualTxnNumber;
    public String mercadoPagoPaymentId;

    public PaymentDocument() {}
}
