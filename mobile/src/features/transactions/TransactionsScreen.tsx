import React, { useEffect, useState } from "react";
import { Alert, Text } from "react-native";
import type { Expense, Payment } from "../../api/contracts";
import { useAuth } from "../../auth/AuthContext";
import { AppButton, AppInput, Card, ScreenContainer } from "../../components/ui";

function makePixPayload(key: string, name: string, city: string, amount: string) {
  return `00020126330014BR.GOV.BCB.PIX01${String(key.length).padStart(2, "0")}${key}520400005303986540${String(amount.length).padStart(2, "0")}${amount}5802BR59${String(name.length).padStart(2, "0")}${name}60${String(city.length).padStart(2, "0")}${city}62070503***6304ABCD`;
}

export default function TransactionsScreen() {
  const { api, me } = useAuth();
  const [txidQuery, setTxidQuery] = useState("");
  const [verifyStatus, setVerifyStatus] = useState("-");
  const [receiptText, setReceiptText] = useState("");
  const [manualTxn, setManualTxn] = useState("");
  const [pixKey, setPixKey] = useState("62904267000160");
  const [pixAmount, setPixAmount] = useState("10.00");
  const [pixPayload, setPixPayload] = useState("");
  const [reconcileStatus, setReconcileStatus] = useState("-");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [confirmPaymentId, setConfirmPaymentId] = useState("");

  const isAdmin = me?.user.role === "admin";

  const load = async () => {
    const [status, paymentRows, expenseRows] = await Promise.all([
      api.getReconciliationStatus().catch(() => null),
      api.listPayments(true),
      api.listExpenses(true),
    ]);
    if (status) {
      setReconcileStatus(
        `total:${status.total} | mp:${status.verified_by_mercado_pago} | ia:${status.verified_by_ai} | pendente:${status.manual_or_pending}`,
      );
    }
    setPayments(paymentRows || []);
    setExpenses(expenseRows || []);
  };

  useEffect(() => {
    load().catch(() => null);
  }, []);

  const verify = async () => {
    try {
      const result = await api.verifyMercadoPagoTransactionId(txidQuery);
      setVerifyStatus(`${result.status} · ${result.message}`);
    } catch (e) {
      Alert.alert("Falha", (e as Error).message);
    }
  };

  const analyzeReceipt = async () => {
    try {
      const result = await api.analyzeReceiptText({ text: receiptText });
      const txnNumber = result.txid || manualTxn;
      if (!txnNumber) throw new Error("Sem txid detectado. Informe manualmente.");
      await api.addPayment({
        type: "pix",
        amount: Number(pixAmount || "0"),
        txid: result.txid,
        manualTxnNumber: result.txid ? undefined : manualTxn,
        verifiedByAI: true,
        aiClassification: result.classification,
      });
      await load();
      Alert.alert("Comprovante vinculado", `Classificação: ${result.classification}`);
    } catch (e) {
      Alert.alert("Falha ao vincular", (e as Error).message);
    }
  };

  const confirmPayment = async () => {
    if (!confirmPaymentId) throw new Error("Informe o ID do pagamento.");
    await api.confirmPayment(confirmPaymentId, { verifiedByMercadoPago: true, txid: txidQuery || undefined });
    await load();
    Alert.alert("Pagamento", "Pagamento confirmado.");
  };

  const reconcile = async () => {
    await api.reconcileMercadoPago({
      txid: txidQuery || undefined,
      manualTxnNumber: manualTxn || undefined,
    });
    await load();
    Alert.alert("Reconciliação", "Reconciliação executada.");
  };

  return (
    <ScreenContainer>
      <Card title="Feed de transações importadas">
        <AppButton title="Atualizar feed" variant="secondary" onPress={() => load().catch((e) => Alert.alert("Falha", (e as Error).message))} />
        <Text>Pagamentos: {payments.length} | Despesas: {expenses.length}</Text>
        <Text>Status reconciliação: {reconcileStatus}</Text>
      </Card>

      <Card title="Verificação por ID/código">
        <AppInput value={txidQuery} onChangeText={setTxidQuery} placeholder="ID/txid" autoCapitalize="none" />
        <AppButton title="Verificar transação" onPress={verify} />
        <Text>Status: {verifyStatus}</Text>
      </Card>

      <Card title="Comprovantes + fallback manual">
        <AppInput value={receiptText} onChangeText={setReceiptText} placeholder="Cole o texto OCR do comprovante" multiline numberOfLines={4} />
        <AppInput value={manualTxn} onChangeText={setManualTxn} placeholder="Número da transação (fallback)" autoCapitalize="none" />
        <AppButton title="Analisar e confirmar" onPress={analyzeReceipt} />
      </Card>

      <Card title="Confirmação e reconciliação (admin)">
        <Text>{isAdmin ? "Ações administrativas habilitadas." : "Ações administrativas desabilitadas para membro."}</Text>
        <AppInput value={confirmPaymentId} onChangeText={setConfirmPaymentId} placeholder="ID do pagamento" autoCapitalize="none" />
        <AppButton title="Confirmar pagamento" disabled={!isAdmin} onPress={() => confirmPayment().catch((e) => Alert.alert("Falha", (e as Error).message))} />
        <AppButton title="Reconciliar por txid/manual" variant="secondary" disabled={!isAdmin} onPress={() => reconcile().catch((e) => Alert.alert("Falha", (e as Error).message))} />
      </Card>

      <Card title="Pagamento Pix (payload/copia-e-cola)">
        <AppInput value={pixKey} onChangeText={setPixKey} placeholder="Chave Pix" autoCapitalize="none" />
        <AppInput value={pixAmount} onChangeText={setPixAmount} placeholder="Valor" keyboardType="decimal-pad" />
        <AppButton title="Gerar payload Pix" onPress={() => setPixPayload(makePixPayload(pixKey, "SPACECWORP", "OSASCO", pixAmount))} />
        {!!pixPayload && <Text selectable>{pixPayload}</Text>}
      </Card>
    </ScreenContainer>
  );
}
