"use client";

import type { ReactNode } from "react";

import { SessionProvider } from "@/components/providers/session-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Every client-side context the app needs, in one place. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delay={300}>
      <SessionProvider>{children}</SessionProvider>
      <Toaster position="top-right" richColors closeButton />
    </TooltipProvider>
  );
}
