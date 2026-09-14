"use client";

import { ChevronsUpDown, LogOut } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/api";

function initials(name: string, email: string): string {
  const source = name.trim() || email.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

interface UserMenuProps {
  /** `sidebar` renders the full-width footer button; `topbar` a compact avatar. */
  variant?: "sidebar" | "topbar";
}

export function UserMenu({ variant = "topbar" }: UserMenuProps) {
  const { user, status, logout } = useSession();
  const { isMobile } = useSidebar();
  const [signingOut, setSigningOut] = useState(false);

  if (status === "loading") {
    return variant === "sidebar" ? (
      <div className="flex items-center gap-2 p-2">
        <Skeleton className="size-8 rounded-lg" />
        <div className="flex-1 space-y-1 group-data-[collapsible=icon]:hidden">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    ) : (
      <Skeleton className="size-8 rounded-full" />
    );
  }
  if (!user) return null;

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
    } catch (error) {
      toast.error(errorMessage(error, "Could not sign out"));
    } finally {
      setSigningOut(false);
    }
  };

  const avatar = (
    <Avatar className="size-8 rounded-lg">
      <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-semibold text-primary">
        {initials(user.name, user.email)}
      </AvatarFallback>
    </Avatar>
  );

  const content = (
    <DropdownMenuContent
      className="min-w-56"
      side={variant === "sidebar" ? (isMobile ? "bottom" : "right") : "bottom"}
      align="end"
      sideOffset={6}
    >
      {/* Base UI requires a group label to live inside a group. */}
      <DropdownMenuGroup>
        <DropdownMenuLabel className="flex items-center gap-2 font-normal">
          {avatar}
          <div className="grid min-w-0 text-sm leading-tight">
            <span className="truncate font-medium">{user.name || user.email}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          </div>
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onClick={onSignOut} disabled={signingOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );

  if (variant === "sidebar") {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  size="lg"
                  className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
                />
              }
            >
              {avatar}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name || user.email}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </DropdownMenuTrigger>
            {content}
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className="rounded-full" aria-label="Account" />}
      >
        {avatar}
      </DropdownMenuTrigger>
      {content}
    </DropdownMenu>
  );
}
