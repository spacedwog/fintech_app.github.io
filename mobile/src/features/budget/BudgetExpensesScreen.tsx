import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Text } from "react-native";
import type { BudgetRow, Category, Expense } from "../../api/contracts";
import { useAuth } from "../../auth/AuthContext";
import { AppButton, AppInput, Card, ScreenContainer } from "../../components/ui";

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
  const [budgetQuota, setBudgetQuota] = useState("-");
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [rules, setRules] = useState<Array<{ id: string; category_id: string; keyword: string; match_type: string }>>([]);
  const [layouts, setLayouts] = useState<Array<{ id: string; name?: string }>>([]);
  const [selectedLayoutId, setSelectedLayoutId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState<string>("");
  const [transactionNumber, setTransactionNumber] = useState("");
  const [expenseId, setExpenseId] = useState("");
  const [ruleKeyword, setRuleKeyword] = useState("");
  const [limitValue, setLimitValue] = useState("");
  const [categoryBudgetName, setCategoryBudgetName] = useState("");
  const [categoryBudgetPrevisto, setCategoryBudgetPrevisto] = useState("");
  const [recurringSourceMonth, setRecurringSourceMonth] = useState("");
  const [recurringAdjustmentPercent, setRecurringAdjustmentPercent] = useState("0");
  const [applyRulesResult, setApplyRulesResult] = useState("-");

  const categoryLabel = useMemo(() => categories.find((c) => c.id === categoryId)?.name || "Sem categoria", [categories, categoryId]);

  const load = async () => {
    const [alerts, overview, groups, cats, exps, fetchedRules, quota, fetchedLayouts] = await Promise.all([
      api.getAlerts(month),
      api.getBudgetOverview(month),
      api.listBudgetGroups(),
      api.listCategories(),
      api.listExpenses(false),
      api.listExpenseRules(),
      api.getBudgetImportQuota(),
      api.listBudgetLayouts().catch(() => []),
    ]);
    setAlertStatus(`${alerts.status} · R$ ${Number(alerts.total_spent || 0).toFixed(2)} / R$ ${Number(alerts.limit_value || 0).toFixed(2)}`);
    setOverviewCount((overview.rows || []).length);
    setGroupsCount((groups || []).length);
    setCategories(cats || []);
    setExpenses(exps || []);
    setRules(fetchedRules || []);
    setBudgetQuota(`${quota.used}/${quota.limit} (${quota.remaining} restante)`);
    setLayouts((fetchedLayouts || []) as Array<{ id: string; name?: string }>);
  };

  useEffect(() => {
    load().catch(() => null);
  }, []);

  const importBudgetFile = async () => {
    try {
      const pick = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
        copyToCacheDirectory: true,
      });
      if (pick.canceled) return;
      const asset = pick.assets[0];
      const lowerName = String(asset.name || "").toLowerCase();
      if (!lowerName.endsWith(".csv")) {
        throw new Error("No mobile atual, a importação local aceita CSV. Para XLS/XLSX, converta para CSV mantendo colunas categoria,previsto.");
      }
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

  const saveMonthlyLimit = async () => {
    await api.setBudget({ month, limit_value: Number(limitValue || "0") });
    setLimitValue("");
    await load();
    Alert.alert("Orçamento", "Limite mensal salvo.");
  };

  const saveCategoryBudget = async () => {
    await api.setCategoryBudget({
      category_id: categoryId || undefined,
      category_name: categoryBudgetName || categoryLabel,
      month,
      previsto: Number(categoryBudgetPrevisto || "0"),
    });
    setCategoryBudgetName("");
    setCategoryBudgetPrevisto("");
    await load();
    Alert.alert("Orçamento por categoria", "Valor previsto salvo.");
  };

  const copyRecurring = async () => {
    await api.copyCategoryBudgetsRecurring({
      targetMonth: month,
      sourceMonth: recurringSourceMonth || undefined,
      adjustmentPercent: Number(recurringAdjustmentPercent || "0"),
    });
    await load();
    Alert.alert("Orçamento recorrente", "Cópia concluída.");
  };

  const addExpense = async () => {
    await api.addExpense({
      amount: Number(amount),
      date,
      description,
      category_id: categoryId || undefined,
      transaction_number: transactionNumber || undefined,
    });
    setDescription("");
    setAmount("");
    setTransactionNumber("");
    await load();
    Alert.alert("Despesa", "Despesa adicionada.");
  };

  const updateExpense = async () => {
    if (!expenseId) throw new Error("Informe o ID da despesa para alterar.");
    await api.updateExpense(expenseId, {
      amount: Number(amount),
      date,
      description,
      category_id: categoryId || undefined,
      transaction_number: transactionNumber || undefined,
    });
    await load();
    Alert.alert("Despesa", "Despesa alterada.");
  };

  const deleteExpense = async () => {
    if (!expenseId) throw new Error("Informe o ID da despesa para excluir.");
    await api.deleteExpense(expenseId);
    setExpenseId("");
    await load();
    Alert.alert("Despesa", "Despesa excluída.");
  };

  const addRule = async () => {
    if (!categoryId || !ruleKeyword) throw new Error("Selecione categoria e palavra-chave.");
    await api.addExpenseRule({ category_id: categoryId, keyword: ruleKeyword, match_type: "contains" });
    setRuleKeyword("");
    await load();
    Alert.alert("Regra criada", `A regra será aplicada para ${categoryLabel}.`);
  };

  const applyRules = async () => {
    const result = await api.applyExpenseRulesToUncategorized(month);
    setApplyRulesResult(`${result.updated} despesa(s) atualizadas em ${month}.`);
    await load();
  };

  return (
    <ScreenContainer>
      <Card title="Orçamento (Importação/Alertas/Visão)">
        <AppInput value={month} onChangeText={setMonth} placeholder="AAAA-MM" autoCapitalize="none" />
        <AppInput value={selectedLayoutId} onChangeText={setSelectedLayoutId} placeholder="Layout de leitura (ID opcional)" autoCapitalize="none" />
        <Text>Layouts disponíveis: {layouts.length}</Text>
        <Text>Quota de importação: {budgetQuota}</Text>
        <AppButton title="Atualizar visão" onPress={() => load().catch((e) => Alert.alert("Falha", (e as Error).message))} />
        <AppButton title="Importar orçamento (csv/xls/xlsx)" onPress={importBudgetFile} variant="secondary" />
        <Text>Alertas: {alertStatus}</Text>
        <Text>Linhas Previsto x Realizado: {overviewCount}</Text>
        <Text>Grupos de orçamento: {groupsCount}</Text>
      </Card>

      <Card title="Adoção do mês e recorrência">
        <AppInput value={limitValue} onChangeText={setLimitValue} placeholder="Limite mensal (R$)" keyboardType="decimal-pad" />
        <AppButton title="Salvar limite do mês" onPress={() => saveMonthlyLimit().catch((e) => Alert.alert("Falha", (e as Error).message))} />
        <AppInput value={categoryBudgetName} onChangeText={setCategoryBudgetName} placeholder="Categoria (nome opcional)" />
        <AppInput value={categoryBudgetPrevisto} onChangeText={setCategoryBudgetPrevisto} placeholder="Previsto por categoria (R$)" keyboardType="decimal-pad" />
        <AppButton title="Salvar orçamento por categoria" variant="secondary" onPress={() => saveCategoryBudget().catch((e) => Alert.alert("Falha", (e as Error).message))} />
        <AppInput value={recurringSourceMonth} onChangeText={setRecurringSourceMonth} placeholder="Copiar do mês (AAAA-MM opcional)" autoCapitalize="none" />
        <AppInput value={recurringAdjustmentPercent} onChangeText={setRecurringAdjustmentPercent} placeholder="Ajuste percentual (%)" keyboardType="decimal-pad" />
        <AppButton title="Copiar orçamento recorrente" onPress={() => copyRecurring().catch((e) => Alert.alert("Falha", (e as Error).message))} />
      </Card>

      <Card title="Despesas (CRUD + comprovante/transação)">
        <AppInput value={expenseId} onChangeText={setExpenseId} placeholder="ID da despesa (para alterar/excluir)" autoCapitalize="none" />
        <AppInput value={description} onChangeText={setDescription} placeholder="Descrição" />
        <AppInput value={amount} onChangeText={setAmount} placeholder="Valor" keyboardType="decimal-pad" />
        <AppInput value={date} onChangeText={setDate} placeholder="AAAA-MM-DD" autoCapitalize="none" />
        <AppInput value={categoryId} onChangeText={setCategoryId} placeholder="ID da categoria" autoCapitalize="none" />
        <AppInput value={transactionNumber} onChangeText={setTransactionNumber} placeholder="Número da transação/comprovante" autoCapitalize="none" />
        <AppButton title="Adicionar despesa" onPress={() => addExpense().catch((e) => Alert.alert("Falha", (e as Error).message))} />
        <AppButton title="Alterar despesa" variant="secondary" onPress={() => updateExpense().catch((e) => Alert.alert("Falha", (e as Error).message))} />
        <AppButton title="Excluir despesa" variant="danger" onPress={() => deleteExpense().catch((e) => Alert.alert("Falha", (e as Error).message))} />
        <Text>Despesas carregadas: {expenses.length}</Text>
      </Card>

      <Card title="Regras automáticas e categorias">
        <AppButton title="Aplicar regras em sem categoria" onPress={() => applyRules().catch((e) => Alert.alert("Falha", (e as Error).message))} />
        <Text>Resultado: {applyRulesResult}</Text>
        <AppInput value={ruleKeyword} onChangeText={setRuleKeyword} placeholder="Palavra-chave da regra" />
        <AppInput value={categoryId} onChangeText={setCategoryId} placeholder="Categoria (ID)" autoCapitalize="none" />
        <AppButton title="Criar regra" onPress={() => addRule().catch((e) => Alert.alert("Falha", (e as Error).message))} variant="secondary" />
        <Text>Regras ativas: {rules.length}</Text>
        <Text>Categorias disponíveis: {categories.length}</Text>
        {rules.slice(0, 5).map((rule) => (
          <Text key={rule.id}>• {rule.keyword} → {rule.category_id}</Text>
        ))}
      </Card>
    </ScreenContainer>
  );
}
