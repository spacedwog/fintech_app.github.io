import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Text } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { AppButton, AppInput, Card, ScreenContainer } from "../../components/ui";
import type { BudgetRow, Category, Expense } from "../../api/contracts";

const monthNow = () => new Date().toISOString().slice(0, 7);

function parseCsvRows(raw: string, month: string): BudgetRow[] {
  const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const out: BudgetRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [category_name, previsto] = lines[i].split(",").map((x) => x.trim());
    const value = Number(String(previsto || "0").replace(",", "."));
    if (!category_name || Number.isNaN(value)) continue;
    out.push({ category_name, previsto: value, month });
  }
  return out;
}

export default function BudgetExpensesScreen() {
  const { api } = useAuth();
  const [month, setMonth] = useState(monthNow());
  const [alertStatus, setAlertStatus] = useState("-");
  const [overviewCount, setOverviewCount] = useState(0);
  const [groupsCount, setGroupsCount] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState<string>("");
  const [ruleKeyword, setRuleKeyword] = useState("");

  const categoryLabel = useMemo(() => categories.find((c) => c.id === categoryId)?.name || "Sem categoria", [categories, categoryId]);

  const load = async () => {
    const [alerts, overview, groups, cats, exps] = await Promise.all([
      api.getAlerts(month),
      api.getBudgetOverview(month),
      api.listBudgetGroups(),
      api.listCategories(),
      api.listExpenses(false),
    ]);
    setAlertStatus(`${alerts.status} · R$ ${Number(alerts.total_spent || 0).toFixed(2)} / R$ ${Number(alerts.limit_value || 0).toFixed(2)}`);
    setOverviewCount((overview.rows || []).length);
    setGroupsCount((groups || []).length);
    setCategories(cats || []);
    setExpenses(exps || []);
  };

  useEffect(() => {
    load().catch(() => null);
  }, []);

  const importCsv = async () => {
    try {
      const pick = await DocumentPicker.getDocumentAsync({ type: "text/csv", copyToCacheDirectory: true });
      if (pick.canceled) return;
      const asset = pick.assets[0];
      const raw = await FileSystem.readAsStringAsync(asset.uri);
      const rows = parseCsvRows(raw, month);
      if (!rows.length) throw new Error("CSV inválido. Use cabeçalho: categoria,previsto");
      await api.importCategoryBudgets({ month, rows });
      await load();
      Alert.alert("Importado", `${rows.length} linhas de orçamento importadas.`);
    } catch (e) {
      Alert.alert("Falha na importação", (e as Error).message);
    }
  };

  const addExpense = async () => {
    try {
      await api.addExpense({
        amount: Number(amount),
        date,
        description,
        category_id: categoryId || undefined,
      });
      setDescription("");
      setAmount("");
      await load();
    } catch (e) {
      Alert.alert("Falha ao salvar despesa", (e as Error).message);
    }
  };

  const addRule = async () => {
    try {
      if (!categoryId || !ruleKeyword) throw new Error("Selecione categoria e palavra-chave.");
      await api.addExpenseRule({ category_id: categoryId, keyword: ruleKeyword, match_type: "contains" });
      setRuleKeyword("");
      Alert.alert("Regra criada", `A regra será aplicada para ${categoryLabel}.`);
    } catch (e) {
      Alert.alert("Falha na regra", (e as Error).message);
    }
  };

  return (
    <ScreenContainer>
      <Card title="Orçamento (Importar/Alertas/Visão)">
        <AppInput value={month} onChangeText={setMonth} placeholder="AAAA-MM" autoCapitalize="none" />
        <AppButton title="Atualizar visão" onPress={() => load().catch((e) => Alert.alert("Falha", (e as Error).message))} />
        <AppButton title="Importar orçamento CSV" onPress={importCsv} variant="secondary" />
        <Text>Alertas: {alertStatus}</Text>
        <Text>Linhas Previsto x Realizado: {overviewCount}</Text>
        <Text>Grupos de orçamento: {groupsCount}</Text>
      </Card>

      <Card title="Despesas (CRUD)">
        <AppInput value={description} onChangeText={setDescription} placeholder="Descrição" />
        <AppInput value={amount} onChangeText={setAmount} placeholder="Valor" keyboardType="decimal-pad" />
        <AppInput value={date} onChangeText={setDate} placeholder="AAAA-MM-DD" autoCapitalize="none" />
        <AppInput value={categoryId} onChangeText={setCategoryId} placeholder="ID da categoria" autoCapitalize="none" />
        <AppButton title="Adicionar despesa" onPress={addExpense} />
        <Text>Despesas carregadas: {expenses.length}</Text>
      </Card>

      <Card title="Regras automáticas e categorias">
        <AppButton title="Aplicar regras em sem categoria" onPress={() => api.applyExpenseRulesToUncategorized(month).then(load).catch((e) => Alert.alert("Falha", (e as Error).message))} />
        <AppInput value={ruleKeyword} onChangeText={setRuleKeyword} placeholder="Palavra-chave da regra" />
        <AppInput value={categoryId} onChangeText={setCategoryId} placeholder="Categoria (ID)" autoCapitalize="none" />
        <AppButton title="Criar regra" onPress={addRule} variant="secondary" />
        <Text>Categorias disponíveis: {categories.length}</Text>
      </Card>
    </ScreenContainer>
  );
}
