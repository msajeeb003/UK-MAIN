import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env, isSupabaseConfigured } from "@/lib/env";

export interface ProxySession {
  /** Verified user claims (JWT validated against the project's keys), or null. */
  user: { sub: string; email: string | null } | null;
  /** Response carrying any refreshed auth cookies. Always return this or copy its cookies. */
  response: NextResponse;
}

/**
 * Load (and, when needed, refresh) the Supabase session for a proxied
 * request. `getClaims()` verifies the access token's signature locally via
 * the project's JWKS and refreshes it when expired, writing the rotated
 * cookies onto the response.
 */
export async function loadProxySession(request: NextRequest): Promise<ProxySession> {
  let response = NextResponse.next({ request });
  if (!isSupabaseConfigured()) return { user: null, response };

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) return { user: null, response };
    const claims = data.claims;
    return {
      user: { sub: claims.sub, email: typeof claims.email === "string" ? claims.email : null },
      response,
    };
  } catch {
    // Supabase unreachable: fail closed (treated as signed out).
    return { user: null, response };
  }
}

/** Build a redirect that keeps any refreshed auth cookies from `from`. */
export function redirectKeepingCookies(from: NextResponse, to: URL): NextResponse {
  const redirect = NextResponse.redirect(to);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
