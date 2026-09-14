import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

/**
 * Server-side Supabase client for Server Components, Route Handlers and
 * Server Actions. Reads the session from the request cookies; writes back
 * refreshed tokens when the calling context allows it (Server Components
 * cannot set cookies, which is why the proxy also refreshes sessions).
 */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component: cookies are read-only there.
          // The proxy refreshes the session on the next request instead.
        }
      },
    },
  });
}
