import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

export function AppButton({ title, onPress, variant = "primary", disabled = false }: { title: string; onPress: () => void; variant?: "primary" | "secondary" | "danger"; disabled?: boolean }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.button, styles[variant], disabled && styles.disabled]}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export function AppInput(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor="#6b7280" style={styles.input} {...props} />;
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function ScreenContainer({ children }: { children: React.ReactNode }) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>{children}</ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  screenContent: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: "white", borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: "#e2e8f0" },
  cardTitle: { fontWeight: "700", fontSize: 16, color: "#0f172a" },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: "#0f172a",
  },
  button: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, alignItems: "center" },
  primary: { backgroundColor: "#2563eb" },
  secondary: { backgroundColor: "#475569" },
  danger: { backgroundColor: "#b91c1c" },
  disabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "600" },
});

export const uiStyles = styles;
