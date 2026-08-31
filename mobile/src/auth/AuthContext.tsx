import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiClient } from "../api/client";
import type { AuthTokens, MeResponse } from "../api/contracts";
import { clearSession, loadApiBaseUrl, loadSession, saveApiBaseUrl, saveSession } from "./sessionStore";
import { logEvent } from "../utils/telemetry";

type AuthState = {
  api: ApiClient;
  baseUrl: string;
  me: MeResponse | null;
  loading: boolean;
  isAuthenticated: boolean;
  setBaseUrl: (url: string) => Promise<void>;
  login: (email: string, password: string, oauthConsent: boolean) => Promise<void>;
  signup: (company_name: string, admin_name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function normalizeTokens(payload: { token?: string; access_token?: string; refresh_token?: string }): AuthTokens {
  if (payload.access_token && payload.refresh_token) {
    return {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      token_type: "Bearer",
    };
  }
  if (payload.token) {
    const parsed = JSON.parse(payload.token);
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      token_type: parsed.token_type || "Bearer",
      expires_in: parsed.expires_in,
    };
  }
  throw new Error("Resposta de autenticação inválida");
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [baseUrl, setBaseUrlState] = useState("");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const api = useMemo(() => new ApiClient(baseUrl || "http://localhost:8080"), [baseUrl]);

  const refreshProfile = useCallback(async () => {
    const profile = await api.me();
    setMe(profile);
  }, [api]);

  useEffect(() => {
    (async () => {
      try {
        const [storedUrl, session] = await Promise.all([loadApiBaseUrl(), loadSession()]);
        if (storedUrl) setBaseUrlState(storedUrl);
        if (session) {
          const tempApi = new ApiClient(storedUrl || "http://localhost:8080");
          const refreshed = await tempApi.tryRefreshSession();
          if (refreshed) {
            const profile = await tempApi.me();
            setMe(profile);
          }
        }
      } catch (e) {
        logEvent("warn", "auth.bootstrap.failed", (e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setBaseUrl = useCallback(async (url: string) => {
    await saveApiBaseUrl(url);
    setBaseUrlState(url);
  }, []);

  const login = useCallback(
    async (email: string, password: string, oauthConsent: boolean) => {
      const auth = await api.login({ email, password, oauth_consent: oauthConsent });
      await saveSession(normalizeTokens(auth));
      await refreshProfile();
    },
    [api, refreshProfile],
  );

  const signup = useCallback(
    async (company_name: string, admin_name: string, email: string, password: string) => {
      const auth = await api.signup({ company_name, admin_name, email, password });
      await saveSession(normalizeTokens(auth));
      await refreshProfile();
    },
    [api, refreshProfile],
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => null);
    await clearSession();
    setMe(null);
  }, [api]);

  return (
    <AuthContext.Provider
      value={{
        api,
        baseUrl,
        me,
        loading,
        isAuthenticated: !!me,
        setBaseUrl,
        login,
        signup,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
