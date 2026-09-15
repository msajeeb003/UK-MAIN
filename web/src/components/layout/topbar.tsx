"use client";

import Link from "next/link";

import { Logo } from "@/components/layout/logo";
import { UserMenu } from "@/components/layout/user-menu";
import { routes } from "@/lib/navigation";

/** Where a project screen mounts its "Projects / Client [ref]" trail. */
export const TOPBAR_CONTEXT_ID = "topbar-context";

/**
 * Sticky, translucent 60px header from the wireframe: the logo (back to the
 * project list), the current project's trail when inside the wizard, and
 * the signed-in user on the right.
 */
export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-[60px] shrink-0 items-center justify-between border-b border-line bg-surface/[.82] px-6 backdrop-blur-[12px] backdrop-saturate-[180%]">
      <div className="flex min-w-0 items-center gap-[26px]">
        <Link href={routes.projects} className="flex shrink-0 items-center gap-2.5 hover:no-underline" aria-label="Projects">
          <Logo />
        </Link>
        <div id={TOPBAR_CONTEXT_ID} className="flex min-w-0 items-center gap-[9px] text-[13px] text-ink-2" />
      </div>
      <UserMenu />
    </header>
  );
}
