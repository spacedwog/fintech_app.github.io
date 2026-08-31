import * as SecureStore from "expo-secure-store";
import type { AuthTokens } from "../api/contracts";

const SESSION_KEY = "fintech_mobile_session_v1";
const BASE_URL_KEY = "fintech_mobile_api_base_v1";

export async function saveSession(tokens: AuthTokens) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(tokens));
}

export async function loadSession(): Promise<AuthTokens | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

export async function saveApiBaseUrl(url: string) {
  await SecureStore.setItemAsync(BASE_URL_KEY, url.trim());
}

export async function loadApiBaseUrl() {
  return (await SecureStore.getItemAsync(BASE_URL_KEY)) || "";
}
