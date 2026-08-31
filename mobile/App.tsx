import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { AuthProvider, useAuth } from "./src/auth/AuthContext";
import AuthScreen from "./src/features/auth/AuthScreen";
import MainNavigation from "./src/navigation/MainNavigation";

function Root() {
  const { loading, isAuthenticated } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <>
      {isAuthenticated ? <MainNavigation /> : <AuthScreen />}
      <StatusBar style="dark" />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
