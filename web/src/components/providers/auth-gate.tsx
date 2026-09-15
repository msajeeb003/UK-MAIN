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
      <div className="min-h-screen">
        <div className="flex h-[60px] items-center justify-between border-b border-line bg-surface px-6">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="size-8 rounded-full" />
        </div>
        <div className="mx-auto max-w-[1100px] px-[26px] pt-[34px]">
          <Skeleton className="mb-6 h-8 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
