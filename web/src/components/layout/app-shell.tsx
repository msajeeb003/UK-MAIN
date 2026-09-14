"use client";

import type { ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { AuthGate } from "@/components/providers/auth-gate";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/**
 * The signed-in application frame: collapsible sidebar, sticky topbar and
 * a scrolling content area. Used by the (app) route group layout.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <Topbar />
          <div className="flex flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </AuthGate>
  );
}
