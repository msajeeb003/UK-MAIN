"use client";

import type { Session } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { setAuthTokenProvider, setUnauthorizedHandler, type SessionUser } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/env";
import { routes } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/client";

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

export interface SessionContextValue {
  user: SessionUser | null;
  status: SessionStatus;
  /** Email + password sign-in. Throws a Supabase AuthError on failure. */
  login: (email: string, password: string) => Promise<void>;
  /** Signs out of Supabase (all devices) and returns to the login page. */
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function toUser(session: Session | null): SessionUser | null {
  const u = session?.user;
  if (!u?.email) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (typeof meta.name === "string" && meta.name) ||
    (typeof meta.full_name === "string" && meta.full_name) ||
    "";
  return { id: u.id, email: u.email, name };
}

/**
 * Owns the signed-in user, backed by Supabase Auth.
 *
 * - The Supabase session lives in cookies (via @supabase/ssr), so the edge
 *   proxy, server components and this client all agree on who is signed in.
 * - Tokens auto-refresh; `onAuthStateChange` keeps this state in sync,
 *   including sign-outs made in another tab.
 * - The backend API client asks this provider for the current access token
 *   (sent as a Bearer header). A 401/403 from the backend signs the user
 *   out and sends them back to the login page.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const configured = isSupabaseConfigured();
  const supabase = useMemo(() => (configured ? createClient() : null), [configured]);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<SessionStatus>(configured ? "loading" : "unauthenticated");
  const expiredNoticeShown = useRef(false);

  const applySession = useCallback((session: Session | null) => {
    const next = toUser(session);
    setUser(next);
    setStatus(next ? "authenticated" : "unauthenticated");
    if (next) expiredNoticeShown.current = false;
  }, []);

  // Initial load + live updates (token refresh, sign-in/out in any tab).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) applySession(data.session);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) applySession(session);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase, applySession]);

  // Hand the backend API client a way to fetch a fresh access token.
  useEffect(() => {
    if (!supabase) return;
    setAuthTokenProvider(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });
    return () => setAuthTokenProvider(null);
  }, [supabase]);

  const goToLogin = useCallback(() => {
    const next = pathname && pathname !== routes.login ? `?next=${encodeURIComponent(pathname)}` : "";
    router.replace(`${routes.login}${next}`);
  }, [pathname, router]);

  // Backend rejected our token: the session is gone or the user was removed.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!expiredNoticeShown.current) {
        expiredNoticeShown.current = true;
        toast.warning("Your session has expired. Please sign in again.");
      }
      void supabase?.auth.signOut({ scope: "local" });
      setUser(null);
      setStatus("unauthenticated");
      goToLogin();
    });
    return () => setUnauthorizedHandler(null);
  }, [goToLogin, supabase]);

  const login = useCallback(
    async (email: string, password: string) => {
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      applySession(data.session);
      expiredNoticeShown.current = false;
    },
    [supabase, applySession],
  );

  const logout = useCallback(async () => {
    try {
      await supabase?.auth.signOut();
    } finally {
      setUser(null);
      setStatus("unauthenticated");
      router.replace(routes.login);
      router.refresh();
    }
  }, [router, supabase]);

  const value = useMemo<SessionContextValue>(
    () => ({ user, status, login, logout }),
    [user, status, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
