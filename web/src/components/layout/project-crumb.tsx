"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { TOPBAR_CONTEXT_ID } from "@/components/layout/topbar";
import { useProject } from "@/hooks/use-project";
import { routes } from "@/lib/navigation";

const subscribeNoop = () => () => {};

/**
 * "Projects / Aldgate Timber Ltd  UKCIB-2418" in the top bar while a
 * project is open (wireframe). The top bar sits outside the project
 * provider, so the trail is portalled into its slot.
 */
export function ProjectCrumb() {
  const { project } = useProject();
  // The slot only exists after hydration; on the server there is nothing to portal into.
  const slot = useSyncExternalStore(
    subscribeNoop,
    () => document.getElementById(TOPBAR_CONTEXT_ID),
    () => null,
  );

  if (!slot) return null;
  const name = project?.clientName?.trim() || "New project";
  const ref = project?.ref?.trim();
  return createPortal(
    <>
      <Link href={routes.projects} className="text-ink-2 hover:text-primary hover:no-underline">
        Projects
      </Link>
      <span className="text-ink-3">/</span>
      <span className="truncate font-medium text-ink">{name}</span>
      {ref && (
        <span className="shrink-0 rounded-[5px] border border-line bg-panel px-[7px] py-0.5 font-mono text-[11px] font-medium text-ink-2">
          {ref}
        </span>
      )}
    </>,
    slot,
  );
}
