import React, { useEffect, useState } from "react";
import { Alert, Text } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { AppButton, AppInput, Card, ScreenContainer } from "../../components/ui";
import type { User } from "../../api/contracts";

export default function TeamScreen() {
  const { api, me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("123456");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [targetUserId, setTargetUserId] = useState("");
  const [targetRole, setTargetRole] = useState<"admin" | "member">("member");

  const load = async () => setUsers(await api.listUsers());
  useEffect(() => { load().catch(() => null); }, []);

  const invite = async () => {
    try {
      await api.inviteUser({ name, email, password, role });
      setName("");
      setEmail("");
      await load();
    } catch (e) {
      Alert.alert("Falha", (e as Error).message);
    }
  };

  const changeRole = async () => {
    if (!targetUserId) throw new Error("Informe o ID do usuário.");
    await api.updateUserRole(targetUserId, targetRole);
    await load();
    Alert.alert("Equipe", "Papel atualizado.");
  };

  const isAdmin = me?.user.role === "admin";

  return (
    <ScreenContainer>
      <Card title="Compartilhamento / Equipe">
        <Text>Usuários na conta: {users.length}</Text>
        {users.slice(0, 8).map((u) => (
          <Text key={u.id}>• {u.name} ({u.role})</Text>
        ))}
      </Card>

      <Card title="Convidar usuário">
        <Text>{isAdmin ? "Ação disponível para admin." : "Você não é admin."}</Text>
        <AppInput value={name} onChangeText={setName} placeholder="Nome" />
        <AppInput value={email} onChangeText={setEmail} placeholder="E-mail" autoCapitalize="none" />
        <AppInput value={password} onChangeText={setPassword} placeholder="Senha inicial" secureTextEntry />
        <AppInput value={role} onChangeText={(v) => setRole(v === "admin" ? "admin" : "member")} placeholder="Role: admin/member" autoCapitalize="none" />
        <AppButton title="Convidar" onPress={invite} disabled={!isAdmin} />
      </Card>

      <Card title="Alterar papel (admin-only)">
        <AppInput value={targetUserId} onChangeText={setTargetUserId} placeholder="ID do usuário" autoCapitalize="none" />
        <AppInput value={targetRole} onChangeText={(v) => setTargetRole(v === "admin" ? "admin" : "member")} placeholder="Novo papel: admin/member" autoCapitalize="none" />
        <AppButton title="Atualizar papel" variant="secondary" disabled={!isAdmin} onPress={() => changeRole().catch((e) => Alert.alert("Falha", (e as Error).message))} />
      </Card>
    </ScreenContainer>
  );
}
