"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env, isSupabaseConfigured } from "@/lib/env";

let browserClient: SupabaseClient | null = null;

/**
 * Browser-side Supabase client (singleton). Sessions are persisted in
 * cookies by `@supabase/ssr`, so the proxy and server components see the
 * same session as the browser.
 */
export function createClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  if (!browserClient) {
    browserClient = createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
  }
  return browserClient;
}
