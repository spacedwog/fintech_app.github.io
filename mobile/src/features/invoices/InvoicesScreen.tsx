import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { AppButton, Card, ScreenContainer } from "../../components/ui";
import type { Invoice } from "../../api/contracts";

export default function InvoicesScreen() {
  const { api } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const load = async () => setInvoices(await api.listInvoices());
  useEffect(() => { load().catch(() => null); }, []);

  return (
    <ScreenContainer>
      <Card title="Comprovantes fiscais">
        <AppButton title="Atualizar" onPress={() => load().catch(() => null)} />
        <Text>Total: {invoices.length}</Text>
        {invoices.slice(0, 10).map((inv) => (
          <Text key={inv.id}>• {inv.number || inv.id} · {inv.status || "-"} · {inv.issued_at || "-"}</Text>
        ))}
      </Card>
    </ScreenContainer>
  );
}
