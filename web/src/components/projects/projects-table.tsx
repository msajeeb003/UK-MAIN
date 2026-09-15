"use client";

import { ArchiveRestore, Ellipsis, FolderClosed, FolderOpen, LoaderCircle } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";

import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
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
import type { ExportFormat, ProjectState } from "@/lib/api/types";
import {
  EXPORT_FORMATS,
  formatUpdated,
  formatUpdatedFull,
  hasReports,
  isClosed,
  projectStatus,
  projectTypeLabel,
} from "@/lib/projects";
import { cn } from "@/lib/utils";

export interface ProjectsTableProps {
  projects: ProjectState[];
  /** Id of the project with an in-flight action (disables its controls). */
  busyId: string | null;
  /** Format currently downloading for `busyId`, if any. */
  busyFormat: ExportFormat | null;
  onOpen: (project: ProjectState) => void;
  onReopen: (project: ProjectState) => void;
  onClose: (project: ProjectState) => void;
  onDownload: (project: ProjectState, format: ExportFormat) => void;
}

/** Wireframe columns: Client 2.2fr · Type 1fr · Policy 1.1fr · Status 1.4fr · Updated 1fr · Files 0.9fr, plus the row menu. */
const GRID = "grid grid-cols-[1fr_auto_32px] md:grid-cols-[2.2fr_1fr_1.1fr_1.4fr_1fr_0.9fr_32px]";

/**
 * S2 project list from the wireframe: a card with a mono header row and
 * one clickable row per project. Files are download links once a
 * presentation exists; the row menu closes or reopens the project.
 */
export function ProjectsTable({ projects, busyId, busyFormat, onOpen, onReopen, onClose, onDownload }: ProjectsTableProps) {
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-card">
      <div className={cn(GRID, "label-mono items-center border-b border-line bg-panel px-[18px] py-3 font-medium")} role="row">
        <span>Client</span>
        <span className="hidden md:block">Type</span>
        <span className="hidden md:block">Policy</span>
        <span>Status</span>
        <span className="hidden md:block">Updated</span>
        <span className="hidden text-right md:block">Files</span>
        <span className="sr-only">Actions</span>
      </div>
      {projects.map((p) => {
        const status = projectStatus(p);
        const closed = isClosed(p);
        const busy = busyId === p.id;
        const reports = hasReports(p);
        const onRowKey = (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(p);
          }
        };
        return (
          <div
            key={p.id}
            role="link"
            tabIndex={0}
            aria-label={`Open ${p.clientName || "untitled project"}`}
            onClick={() => onOpen(p)}
            onKeyDown={onRowKey}
            className={cn(
              GRID,
              "cursor-pointer items-center border-b border-line-2 px-[18px] py-[15px] text-[13.5px] transition-colors last:border-b-0 hover:bg-panel focus-visible:bg-panel focus-visible:outline-none",
              busy && "opacity-60",
            )}
          >
            <div className="min-w-0">
              <div className={cn("truncate font-semibold", closed ? "text-ink-2" : "text-ink")}>{p.clientName || "Untitled project"}</div>
              <div className="truncate font-mono text-[11.5px] text-ink-3">{p.ref || p.id}</div>
              <div className="mt-0.5 text-xs text-ink-2 md:hidden">
                {projectTypeLabel(p)} · {formatUpdated(p.updated) || "not saved yet"}
              </div>
            </div>
            <span className="hidden text-ink-2 md:block">{projectTypeLabel(p)}</span>
            <span className="hidden text-ink-2 md:block">
              {typeof p.policyType === "string" && p.policyType ? p.policyType : "—"}
            </span>
            <span>
              <ProjectStatusBadge status={status} />
            </span>
            <span className="hidden text-[12.5px] text-ink-2 md:block" title={formatUpdatedFull(p.updated)}>
              {formatUpdated(p.updated) || "—"}
            </span>
            <span className="hidden text-right font-mono text-[11px] font-medium text-ink-3 md:block" onClick={stop}>
              {reports ? (
                EXPORT_FORMATS.filter((f) => f.format !== "limits-xlsx").map((f, i) => (
                  <span key={f.format}>
                    {i > 0 && " · "}
                    <button
                      type="button"
                      title={`Download ${f.label}`}
                      aria-label={`Download ${f.label} for ${p.clientName || "project"}`}
                      disabled={busy}
                      onClick={() => onDownload(p, f.format)}
                      className="text-primary hover:underline disabled:opacity-50"
                    >
                      {busy && busyFormat === f.format ? <LoaderCircle className="inline size-3 animate-spin" /> : f.short}
                    </button>
                  </span>
                ))
              ) : (
                <span title="No presentation generated yet">—</span>
              )}
            </span>
            <span className="text-right" onClick={stop}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.clientName || "project"}`} disabled={busy} />}
                >
                  <Ellipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="truncate">{p.clientName || "Untitled project"}</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => onOpen(p)}>
                      <FolderOpen />
                      {closed ? "View (read-only)" : "Open review"}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  {reports && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Download</DropdownMenuLabel>
                        {EXPORT_FORMATS.map((f) => (
                          <DropdownMenuItem key={f.format} onClick={() => onDownload(p, f.format)}>
                            {f.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    {closed ? (
                      <DropdownMenuItem onClick={() => onReopen(p)}>
                        <ArchiveRestore />
                        Reopen project
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => onClose(p)}>
                        <FolderClosed />
                        Close project
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>
        );
      })}
    </div>
  );
}
