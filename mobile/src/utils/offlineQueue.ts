import AsyncStorage from "@react-native-async-storage/async-storage";
import { logEvent } from "./telemetry";

const KEY = "fintech_mobile_offline_queue_v1";

export type QueuedAction = {
  id: string;
  method: string;
  path: string;
  body?: unknown;
  createdAt: string;
};

export async function loadQueue(): Promise<QueuedAction[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function enqueueAction(item: Omit<QueuedAction, "id" | "createdAt">) {
  const list = await loadQueue();
  const next: QueuedAction = {
    ...item,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(KEY, JSON.stringify([next, ...list].slice(0, 500)));
  logEvent("warn", "offline.queue.added", "Ação salva para sincronização futura", { path: item.path, method: item.method });
  return next;
}

export async function clearQueue() {
  await AsyncStorage.removeItem(KEY);
}

export async function setQueue(items: QueuedAction[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}
