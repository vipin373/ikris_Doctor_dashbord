"use client";

import * as React from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Me } from "@/lib/types";

type AuthState = {
  session: Session | null;
  me: Me | null;
  loading: boolean;
  accessError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [me, setMe] = React.useState<Me | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [accessError, setAccessError] = React.useState<string | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();

  const loadMe = React.useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api.get<Me>("/me"));
      setAccessError(null);
    } catch (err) {
      setMe(null);
      setAccessError(err instanceof ApiError ? err.message : "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const client = supabase();
    client.auth.getSession().then(({ data }) => loadMe(data.session));
    const { data: sub } = client.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT") {
        setSession(null);
        setMe(null);
        queryClient.clear();
      } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        loadMe(s);
      } else if (event === "TOKEN_REFRESHED") {
        setSession(s);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadMe, queryClient]);

  const signOut = React.useCallback(async () => {
    try {
      await api.post("/auth/session-event?event=logout");
    } catch {
      /* session may already be gone */
    }
    await supabase().auth.signOut();
    queryClient.clear();
    try {
      window.localStorage.removeItem("ikris:columns");
    } catch {
      /* ignore */
    }
    setMe(null);
    setSession(null);
    router.replace("/login");
  }, [queryClient, router]);

  React.useEffect(() => {
    const handler = () => {
      supabase().auth.signOut();
      queryClient.clear();
      router.replace("/login?expired=1");
    };
    window.addEventListener("ikris:unauthorized", handler);
    return () => window.removeEventListener("ikris:unauthorized", handler);
  }, [queryClient, router]);

  const signIn = React.useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
    setLoading(true);
    await loadMe(data.session);
    api.post("/auth/session-event?event=login").catch(() => undefined);
  }, [loadMe]);

  const value = React.useMemo(
    () => ({ session, me, loading, accessError, signIn, signOut }),
    [session, me, loading, accessError, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
