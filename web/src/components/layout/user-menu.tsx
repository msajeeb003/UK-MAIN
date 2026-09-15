"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/**
 * The top bar's user block from the wireframe: name over a second line,
 * then a round initials avatar. Clicking it opens the sign-out menu.
 */
export function UserMenu() {
  const { user, status, logout } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  if (status === "loading") {
    return (
      <div className="flex items-center gap-3.5">
        <div className="space-y-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-2.5 w-24" />
        </div>
        <Skeleton className="size-8 rounded-full" />
      </div>
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" className="flex items-center gap-3.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label="Account" />}
      >
        <span className="hidden text-right leading-[1.2] sm:block">
          <span className="block text-[13px] font-medium text-ink">{user.name || user.email}</span>
          <span className="block text-[11px] text-ink-3">{user.name ? user.email : "Signed in"}</span>
        </span>
        <span className="grid size-8 place-items-center rounded-full bg-set-soft text-[13px] font-semibold text-set">
          {initials(user.name, user.email)}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56" align="end" sideOffset={6}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
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
    </DropdownMenu>
  );
}
