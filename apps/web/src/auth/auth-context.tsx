import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, refreshSession, setAccessToken, type SessionUser } from "@/lib/api";
import { PermissionProvider } from "./permissions";

type State = { status: "loading" } | { status: "anon" } | { status: "authed"; user: SessionUser };

interface AuthApi {
  state: State;
  login: (email: string, password: string, totp?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-read the current user (after password change / 2FA setup). */
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    void refreshSession().then((user) => setState(user ? { status: "authed", user } : { status: "anon" }));
  }, []);

  const login = useCallback(async (email: string, password: string, totp?: string) => {
    const data = await api<{ accessToken: string; user: SessionUser }>("/auth/login", {
      method: "POST",
      body: { email, password, totp: totp || undefined },
      noRetry: true,
    });
    setAccessToken(data.accessToken);
    setState({ status: "authed", user: data.user });
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST", noRetry: true }).catch(() => undefined);
    setAccessToken(null);
    setState({ status: "anon" });
  }, []);

  const reload = useCallback(async () => {
    const user = await api<SessionUser>("/auth/me");
    setState({ status: "authed", user });
  }, []);

  const value = useMemo(() => ({ state, login, logout, reload }), [state, login, logout, reload]);
  const permissions = state.status === "authed" ? state.user.permissions : [];
  return (
    <Ctx.Provider value={value}>
      <PermissionProvider permissions={permissions}>{children}</PermissionProvider>
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

export function useUser(): SessionUser {
  const { state } = useAuth();
  if (state.status !== "authed") throw new Error("useUser outside an authenticated route");
  return state.user;
}
