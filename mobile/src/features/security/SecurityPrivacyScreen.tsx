import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import React, { useEffect, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { AppButton, Card, ScreenContainer } from "../../components/ui";

export default function SecurityPrivacyScreen() {
  const { api, logout } = useAuth();
  const [marketing, setMarketing] = useState(false);
  const [auditCount, setAuditCount] = useState(0);

  const load = async () => {
    const [consent, audit] = await Promise.all([api.getPrivacyConsent(), api.listAuditTrail(50)]);
    setMarketing(!!consent.marketing);
    setAuditCount(audit.length);
  };

  useEffect(() => { load().catch(() => null); }, []);

  const saveConsent = async (value: boolean) => {
    setMarketing(value);
    await api.setPrivacyConsent(value);
  };

  const exportMyData = async () => {
    const data = await api.exportMyData();
    const uri = `${FileSystem.cacheDirectory}my-data.json`;
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(data, null, 2));
    await Sharing.shareAsync(uri);
  };

  const deleteAccount = async () => {
    Alert.alert("Excluir conta", "Deseja excluir sua conta?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: async () => {
          await api.deleteAccount();
          await logout();
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      <Card title="Segurança da sessão">
        <Text>Auditoria recente: {auditCount} eventos</Text>
        <AppButton title="Encerrar sessão (logout + revogação)" variant="secondary" onPress={() => logout().catch(() => null)} />
      </Card>

      <Card title="Privacidade (LGPD)">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text>Consentimento de marketing</Text>
          <Switch value={marketing} onValueChange={(value) => saveConsent(value).catch((e) => Alert.alert("Falha", (e as Error).message))} />
        </View>
        <AppButton title="Baixar meus dados (.json)" onPress={() => exportMyData().catch((e) => Alert.alert("Falha", (e as Error).message))} />
        <AppButton title="Excluir minha conta" variant="danger" onPress={deleteAccount} />
      </Card>
    </ScreenContainer>
  );
}
