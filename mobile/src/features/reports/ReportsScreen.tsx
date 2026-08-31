import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import React, { useState } from "react";
import { Alert, Text } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { AppButton, AppInput, Card, ScreenContainer } from "../../components/ui";

const monthNow = () => new Date().toISOString().slice(0, 7);

async function shareTextAsFile(filename: string, content: string) {
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, content);
  await Sharing.shareAsync(uri);
}

export default function ReportsScreen() {
  const { api } = useAuth();
  const [month, setMonth] = useState(monthNow());
  const [summary, setSummary] = useState("-");

  const loadReports = async () => {
    try {
      const [monthly, categories, projection, checklist, origin] = await Promise.all([
        api.monthlyReport(true),
        api.categoryReport(true),
        api.getMonthlyProjection(month),
        api.getMonthlyCloseChecklist(month),
        api.getTransactionOriginReport(month),
      ]);
      setSummary(
        `Indicadores carregados · monthly:${Array.isArray(monthly) ? monthly.length : 1} ` +
          `category:${Array.isArray(categories) ? categories.length : 1} ` +
          `projection:${projection ? "ok" : "-"} checklist:${checklist ? "ok" : "-"} origin:${origin ? "ok" : "-"}`,
      );
    } catch (e) {
      Alert.alert("Falha", (e as Error).message);
    }
  };

  const exportData = async (format: "csv" | "xls" | "pdf") => {
    try {
      const data = await api.getConsolidatedExportData(month);
      const content = JSON.stringify(data, null, 2);
      await shareTextAsFile(`fintech-${month}.${format === "xls" ? "txt" : format}`, content);
    } catch (e) {
      Alert.alert("Falha na exportação", (e as Error).message);
    }
  };

  return (
    <ScreenContainer>
      <Card title="Relatórios operacionais">
        <AppInput value={month} onChangeText={setMonth} placeholder="AAAA-MM" autoCapitalize="none" />
        <AppButton title="Carregar indicadores e projeções" onPress={loadReports} />
        <Text>{summary}</Text>
      </Card>

      <Card title="Exportação consolidada (mobile)">
        <AppButton title="Exportar CSV" variant="secondary" onPress={() => exportData("csv")} />
        <AppButton title="Exportar Excel" variant="secondary" onPress={() => exportData("xls")} />
        <AppButton title="Exportar PDF" variant="secondary" onPress={() => exportData("pdf")} />
      </Card>
    </ScreenContainer>
  );
}
