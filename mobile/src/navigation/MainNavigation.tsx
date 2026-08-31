import React, { useMemo, useState } from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { AppButton } from "../components/ui";
import BudgetExpensesScreen from "../features/budget/BudgetExpensesScreen";
import InvoicesScreen from "../features/invoices/InvoicesScreen";
import PlanScreen from "../features/plan/PlanScreen";
import ReportsScreen from "../features/reports/ReportsScreen";
import SecurityPrivacyScreen from "../features/security/SecurityPrivacyScreen";
import SettingsScreen from "../features/settings/SettingsScreen";
import TeamScreen from "../features/team/TeamScreen";
import TransactionsScreen from "../features/transactions/TransactionsScreen";

type MenuKey =
  | "budget-expenses"
  | "transactions"
  | "invoices"
  | "plan"
  | "reports"
  | "team"
  | "security-privacy"
  | "settings";

export default function MainNavigation() {
  const { me, logout } = useAuth();
  const [active, setActive] = useState<MenuKey>("budget-expenses");
  const scopes = me?.user.scope || [];
  const canAccessTeam = me?.user.role === "admin" || scopes.includes("team:read");

  const Current = useMemo(() => {
    if (active === "budget-expenses") return <BudgetExpensesScreen />;
    if (active === "transactions") return <TransactionsScreen />;
    if (active === "invoices") return <InvoicesScreen />;
    if (active === "plan") return <PlanScreen />;
    if (active === "reports") return <ReportsScreen />;
    if (active === "team") return <TeamScreen />;
    if (active === "security-privacy") return <SecurityPrivacyScreen />;
    return <SettingsScreen />;
  }, [active]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Fintech Mobile iOS</Text>
        <Text>{me?.tenant.name} · {me?.tenant.plan}</Text>
      </View>

      <View style={styles.menu}>
        <AppButton title="Orçamento & Despesas" variant={active === "budget-expenses" ? "primary" : "secondary"} onPress={() => setActive("budget-expenses")} />
        <AppButton title="Transação" variant={active === "transactions" ? "primary" : "secondary"} onPress={() => setActive("transactions")} />
        <AppButton title="Nota Fiscal" variant={active === "invoices" ? "primary" : "secondary"} onPress={() => setActive("invoices")} />
        <AppButton title="Plano" variant={active === "plan" ? "primary" : "secondary"} onPress={() => setActive("plan")} />
        <AppButton title="Resumo" variant={active === "reports" ? "primary" : "secondary"} onPress={() => setActive("reports")} />
        {canAccessTeam ? (
          <AppButton title="Compartilhamento" variant={active === "team" ? "primary" : "secondary"} onPress={() => setActive("team")} />
        ) : null}
        <AppButton title="Segurança/Privacidade" variant={active === "security-privacy" ? "primary" : "secondary"} onPress={() => setActive("security-privacy")} />
        <AppButton title="Configurações" variant={active === "settings" ? "primary" : "secondary"} onPress={() => setActive("settings")} />
      </View>

      <View style={styles.content}>{Current}</View>

      <View style={styles.footer}>
        <Text>{me?.user.name} ({me?.user.role})</Text>
        <AppButton title="Sair" variant="danger" onPress={() => logout().catch(() => null)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#e2e8f0" },
  header: { padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#cbd5e1" },
  title: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  menu: { padding: 10, gap: 6, backgroundColor: "#f1f5f9" },
  content: { flex: 1 },
  footer: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
    backgroundColor: "#fff",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
});
