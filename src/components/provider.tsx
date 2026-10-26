"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { demoRequest, resetDemo } from "@/lib/demo";
import type { Forecast, ManagerOverview, User } from "@/lib/types";
type Context = {
  mode: "demo" | "live";
  user: User | null;
  ready: boolean;
  api: <T>(
    path: string,
    method?: string,
    body?: Record<string, unknown>,
  ) => Promise<T>;
  signIn: (body: Record<string, unknown>) => Promise<void>;
  signOut: () => Promise<void>;
  reset: () => void;
};
const AppContext = createContext<Context | null>(null);
export function Provider({
  mode,
  children,
}: {
  mode: "demo" | "live";
  children: ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const api = useCallback(
    async <T,>(
      path: string,
      method = "GET",
      body?: Record<string, unknown>,
    ): Promise<T> => {
      if (mode === "demo") {
        const result = await demoRequest<T>(path, method, body);
        if (path === "/manager/overview") {
          const overview = result as ManagerOverview;
          try {
            const response = await fetch(
              `/api/demo/forecasts?buffer=${overview.settings.safetyBuffer}`,
              {
                cache: "no-store",
                signal: AbortSignal.timeout(15_000),
              },
            );
            if (!response.ok) throw new Error("Prediction service unavailable");
            const data = (await response.json()) as { forecasts: Forecast[] };
            overview.forecasts = data.forecasts;
          } catch {
            overview.forecasts = overview.forecasts.map((f) => ({
              ...f,
              source: "local",
              mlStatus: "unavailable",
              note: "Prediction connection unavailable. Showing the local average.",
            }));
          }
        }
        return result;
      }
      const response = await fetch(`/api${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) setUser(null);
        throw new Error(data.error ?? "Request failed.");
      }
      return data;
    },
    [mode],
  );
  useEffect(() => {
    let active = true;
    api<{ user: User | null }>("/session")
      .then((r) => {
        if (active) setUser(r.user);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [api]);
  const signIn = async (body: Record<string, unknown>) => {
    const { user } = await api<{ user: User }>("/auth/login", "POST", body);
    setUser(user);
    router.push(user.role === "manager" ? "/manager" : "/student");
  };
  const signOut = async () => {
    await api("/auth/logout", "POST");
    setUser(null);
    router.push("/login");
  };
  const reset = () => {
    resetDemo();
    setUser(null);
    router.push("/login");
  };
  return (
    <AppContext.Provider
      value={{ mode, user, ready, api, signIn, signOut, reset }}
    >
      {children}
    </AppContext.Provider>
  );
}
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("App provider is missing");
  return value;
}
