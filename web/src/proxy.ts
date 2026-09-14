import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseConfigured } from "@/lib/env";
import { loadProxySession, redirectKeepingCookies } from "@/lib/supabase/proxy-session";

/**
 * Edge routing guard backed by Supabase Auth. Every page request:
 *   1. refreshes the Supabase session if its access token expired
 *      (rotated cookies are written onto the response),
 *   2. verifies the access token's signature,
 *   3. sends signed-out users to /login (remembering where they were) and
 *      signed-in users away from /login.
 * `/api/*` is excluded by the matcher: the backend does its own token check.
 */
const LOGIN_PATH = "/login";
const HOME_PATH = "/projects";

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : HOME_PATH;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Misconfigured deployment: let /login render its configuration notice,
  // and keep everything else behind it.
  if (!isSupabaseConfigured()) {
    if (pathname === LOGIN_PATH) return NextResponse.next();
    return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  }

  const { user, response } = await loadProxySession(request);

  if (pathname === LOGIN_PATH) {
    if (!user) return response;
    const target = new URL(safeNext(request.nextUrl.searchParams.get("next")), request.url);
    return redirectKeepingCookies(response, target);
  }

  if (!user) {
    const login = new URL(LOGIN_PATH, request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return redirectKeepingCookies(response, login);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except the API proxy, Next internals and static assets.
    "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
