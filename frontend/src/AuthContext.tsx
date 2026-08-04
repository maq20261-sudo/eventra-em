import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, getToken, setToken, User } from "./api";
import { firebaseSignOut } from "./firebase";

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string, role?: "consumer" | "organizer") => Promise<User | { multiple_roles: true; roles: string[] }>;
  signUp: (email: string, password: string, name: string, role: "consumer" | "organizer") => Promise<User>;
  signInWithToken: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      await setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = async (email: string, password: string, role?: "consumer" | "organizer") => {
    const res = await api.login({ email, password, role });
    // Multi-role response — caller must prompt user for role and retry.
    if (res && (res as any).multiple_roles) {
      return { multiple_roles: true as const, roles: (res as any).roles as string[] };
    }
    await setToken(res.access_token);
    setUser(res.user);
    return res.user as User;
  };

  const signUp = async (email: string, password: string, name: string, role: "consumer" | "organizer") => {
    const res = await api.register({ email, password, name, role });
    await setToken(res.access_token);
    setUser(res.user);
    return res.user as User;
  };

  const signInWithToken = async (token: string, u: User) => {
    await setToken(token);
    setUser(u);
  };

  const signOut = async () => {
    // Ask the server to invalidate any outstanding JWTs (fire-and-forget —
    // if the network's down we still clear the local session).
    try { await api.logout(); } catch { /* ignore */ }
    await setToken(null);
    setUser(null);
    await firebaseSignOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signInWithToken, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
