import React, { useState } from "react";
import { Alert, Text } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { AppButton, AppInput, Card, ScreenContainer } from "../../components/ui";
import { getTelemetryEvents } from "../../utils/telemetry";

export default function SettingsScreen() {
  const { api, me, baseUrl, setBaseUrl } = useAuth();
  const [name, setName] = useState(me?.user.name || "");
  const [document, setDocument] = useState(me?.user.tax_document || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [apiUrl, setApiUrl] = useState(baseUrl);

  const saveProfile = async () => {
    await api.updateProfile({ name, document });
    Alert.alert("Perfil", "Perfil atualizado.");
  };

  const savePassword = async () => {
    await api.changePassword({ currentPassword, newPassword });
    setCurrentPassword("");
    setNewPassword("");
    Alert.alert("Senha", "Senha alterada.");
  };

  const syncOffline = async () => {
    const result = await api.syncOfflineQueue();
    Alert.alert("Sincronização", `${result.synced} ação(ões) sincronizadas, ${result.pending} pendentes.`);
  };

  return (
    <ScreenContainer>
      <Card title="Configuração de API">
        <AppInput value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" />
        <AppButton title="Salvar endpoint" onPress={() => setBaseUrl(apiUrl).catch((e) => Alert.alert("Falha", (e as Error).message))} />
      </Card>

      <Card title="Meu perfil">
        <AppInput value={name} onChangeText={setName} placeholder="Nome" />
        <AppInput value={document} onChangeText={setDocument} placeholder="Documento" autoCapitalize="none" />
        <AppButton title="Salvar perfil" onPress={() => saveProfile().catch((e) => Alert.alert("Falha", (e as Error).message))} />
      </Card>

      <Card title="Alterar senha">
        <AppInput value={currentPassword} onChangeText={setCurrentPassword} placeholder="Senha atual" secureTextEntry />
        <AppInput value={newPassword} onChangeText={setNewPassword} placeholder="Nova senha" secureTextEntry />
        <AppButton title="Alterar senha" onPress={() => savePassword().catch((e) => Alert.alert("Falha", (e as Error).message))} />
      </Card>

      <Card title="Offline / Telemetria">
        <AppButton title="Sincronizar fila offline" variant="secondary" onPress={() => syncOffline().catch((e) => Alert.alert("Falha", (e as Error).message))} />
        <Text>Eventos locais de telemetria: {getTelemetryEvents().length}</Text>
      </Card>
    </ScreenContainer>
  );
}
