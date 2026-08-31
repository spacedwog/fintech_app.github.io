export type TelemetryEvent = {
  level: "info" | "warn" | "error";
  name: string;
  message?: string;
  context?: Record<string, unknown>;
  at: string;
};

const MAX_EVENTS = 200;
const events: TelemetryEvent[] = [];

export function logEvent(level: TelemetryEvent["level"], name: string, message?: string, context?: Record<string, unknown>) {
  events.unshift({ level, name, message, context, at: new Date().toISOString() });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  const payload = { level, name, message, context };
  if (level === "error") console.error("[mobile-telemetry]", payload);
  else if (level === "warn") console.warn("[mobile-telemetry]", payload);
  else console.log("[mobile-telemetry]", payload);
}

export function getTelemetryEvents() {
  return [...events];
}
