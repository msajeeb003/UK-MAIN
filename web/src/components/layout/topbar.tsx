"use client";

import type { ReactNode } from "react";

import { AppBreadcrumbs } from "@/components/layout/app-breadcrumbs";
import { UserMenu } from "@/components/layout/user-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface TopbarProps {
  /** Right-aligned slot for page-level actions (save status, buttons). */
  actions?: ReactNode;
}

/** Sticky, translucent header above the page content (wireframe "topbar"). */
export function Topbar({ actions }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <AppBreadcrumbs />
      <div className="ml-auto flex items-center gap-2">
        {actions}
        <UserMenu variant="topbar" />
      </div>
    </header>
  );
}
