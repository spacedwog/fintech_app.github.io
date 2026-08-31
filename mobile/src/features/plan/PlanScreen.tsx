import React, { useEffect, useState } from "react";
import { Alert, Text } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { AppButton, Card, ScreenContainer } from "../../components/ui";
import type { Payment } from "../../api/contracts";

export default function PlanScreen() {
  const { api, me, refreshProfile } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);

  const load = async () => setPayments(await api.listPayments(true));
  useEffect(() => { load().catch(() => null); }, []);

  const switchPlan = async (plan: "free" | "premium") => {
    try {
      await api.changePlan(plan);
      await refreshProfile();
      await load();
    } catch (e) {
      Alert.alert("Falha", (e as Error).message);
    }
  };

  return (
    <ScreenContainer>
      <Card title="Plano da conta">
        <Text>Plano atual: {me?.tenant.plan || "-"}</Text>
        <AppButton title="Trocar para Free" variant="secondary" onPress={() => switchPlan("free")} />
        <AppButton title="Trocar para Premium" onPress={() => switchPlan("premium")} />
      </Card>

      <Card title="Histórico de pagamentos">
        <Text>Pagamentos: {payments.length}</Text>
        {payments.slice(0, 10).map((p) => (
          <Text key={p.id}>• {p.date} · {p.type} · R$ {Number(p.amount || 0).toFixed(2)}</Text>
        ))}
      </Card>
    </ScreenContainer>
  );
}
