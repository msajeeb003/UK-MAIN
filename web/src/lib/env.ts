/**
 * Public runtime configuration. Only `NEXT_PUBLIC_*` variables are inlined
 * into the browser bundle; everything else stays server-side.
 */
export const env = {
  /** Prefix for every backend API call. Defaults to the same-origin `/api` proxy. */
  apiBaseUrl: (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api").replace(/\/$/, ""),
  appName: "Quote Comparison Tool",
  /** Supabase project URL, e.g. https://abcd.supabase.co */
  supabaseUrl: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, ""),
  /** Supabase anon / publishable key (safe to expose; RLS + Auth policies apply). */
  supabaseAnonKey:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "",
} as const;

/** True when both Supabase public settings are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}
