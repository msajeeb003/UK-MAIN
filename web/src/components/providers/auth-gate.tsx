"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { routes } from "@/lib/navigation";

/**
 * Renders its children only for an authenticated session. The edge proxy
 * already redirects requests with no session cookie; this catches the case
 * where the cookie exists but the backend no longer accepts it.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`${routes.login}?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-64 border-r bg-sidebar p-4 md:block">
          <Skeleton className="mb-6 h-8 w-40" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="mb-6 h-8 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
