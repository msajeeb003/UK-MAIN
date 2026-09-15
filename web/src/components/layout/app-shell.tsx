"use client";

import type { ReactNode } from "react";

import { Topbar } from "@/components/layout/topbar";
import { AuthGate } from "@/components/providers/auth-gate";

/**
 * The signed-in application frame from the wireframe: a sticky, translucent
 * top bar and the page below it. There is no sidebar — the wizard's stepper
 * bar and each page's own container come from the route layouts.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <div className="flex min-h-screen flex-col">
        <Topbar />
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    </AuthGate>
  );
}
