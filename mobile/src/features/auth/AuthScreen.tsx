import React, { useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { AppButton, AppInput, Card, ScreenContainer } from "../../components/ui";

export default function AuthScreen() {
  const { login, signup, setBaseUrl, baseUrl } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [serverUrl, setServerUrl] = useState(baseUrl || "http://localhost:8080");
  const [company, setCompany] = useState("Minhas Finanças");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [oauthConsent, setOauthConsent] = useState(false);

  const handleAuth = async () => {
    try {
      await setBaseUrl(serverUrl);
      if (mode === "login") {
        if (!oauthConsent) throw new Error("Confirme o consentimento OAuth para entrar.");
        await login(email, password, true);
      } else {
        await signup(company, name, email, password);
      }
    } catch (e) {
      Alert.alert("Falha", (e as Error).message);
    }
  };

  return (
    <ScreenContainer>
      <Card title="Servidor da API">
        <AppInput value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" placeholder="https://api.sua-fintech.com" />
        <Text>Use a mesma API do sistema atual para manter paridade funcional.</Text>
      </Card>

      <Card title={mode === "login" ? "Entrar" : "Criar conta"}>
        {mode === "signup" && <AppInput value={company} onChangeText={setCompany} placeholder="Nome da conta" />}
        {mode === "signup" && <AppInput value={name} onChangeText={setName} placeholder="Nome do administrador" />}
        <AppInput value={email} onChangeText={setEmail} placeholder="E-mail" autoCapitalize="none" keyboardType="email-address" />
        <AppInput value={password} onChangeText={setPassword} placeholder="Senha" secureTextEntry />

        {mode === "login" && (
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text>Consentimento OAuth (PKCE)</Text>
            <Switch value={oauthConsent} onValueChange={setOauthConsent} />
          </View>
        )}

        <AppButton title={mode === "login" ? "Entrar" : "Criar conta"} onPress={handleAuth} />
        <AppButton
          variant="secondary"
          title={mode === "login" ? "Ir para cadastro" : "Ir para login"}
          onPress={() => setMode(mode === "login" ? "signup" : "login")}
        />
      </Card>
    </ScreenContainer>
  );
}
