"use client";

import {
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ellipsis,
  FolderClosed,
  FolderOpen,
  LoaderCircle,
} from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ExportFormat, ProjectState } from "@/lib/api/types";
import {
  EXPORT_FORMATS,
  formatUpdated,
  hasReports,
  isClosed,
  projectStatus,
  projectTypeLabel,
} from "@/lib/projects";
import { cn } from "@/lib/utils";

export type SortKey = "client" | "updated" | "status";
export type SortDir = "asc" | "desc";

export interface ProjectsTableProps {
  projects: ProjectState[];
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  /** Id of the project with an in-flight action (disables its controls). */
  busyId: string | null;
  /** Format currently downloading for `busyId`, if any. */
  busyFormat: ExportFormat | null;
  onOpen: (project: ProjectState) => void;
  onReopen: (project: ProjectState) => void;
  onClose: (project: ProjectState) => void;
  onDownload: (project: ProjectState, format: ExportFormat) => void;
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  sort: ProjectsTableProps["sort"];
  onSort: ProjectsTableProps["onSort"];
  className?: string;
}) {
  const active = sort.key === column;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "label-mono inline-flex items-center gap-1 rounded hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon className="size-3" />
      </button>
    </TableHead>
  );
}

/**
 * S2 project table (BRD: client name, type, date, status, download links;
 * reopening returns to the review screen). Narrow screens keep Client,
 * Status and actions; the other columns come back from `md` / `lg` up.
 */
export function ProjectsTable({
  projects,
  sort,
  onSort,
  busyId,
  busyFormat,
  onOpen,
  onReopen,
  onClose,
  onDownload,
}: ProjectsTableProps) {
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      <Table className="md:min-w-[640px]">
        <TableHeader className="bg-panel">
          <TableRow className="hover:bg-transparent">
            <SortHeader label="Client" column="client" sort={sort} onSort={onSort} className="pl-4" />
            <TableHead className="label-mono hidden md:table-cell">Type</TableHead>
            <TableHead className="label-mono hidden lg:table-cell">Policy</TableHead>
            <SortHeader label="Status" column="status" sort={sort} onSort={onSort} />
            <SortHeader
              label="Updated"
              column="updated"
              sort={sort}
              onSort={onSort}
              className="hidden md:table-cell"
            />
            <TableHead className="label-mono text-right">Files</TableHead>
            <TableHead className="w-12 pr-3">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((p) => {
            const status = projectStatus(p);
            const closed = isClosed(p);
            const busy = busyId === p.id;
            const reports = hasReports(p);
            const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(p);
              }
            };
            return (
              <TableRow
                key={p.id}
                tabIndex={0}
                role="link"
                aria-label={`Open ${p.clientName || "untitled project"}`}
                onClick={() => onOpen(p)}
                onKeyDown={onRowKey}
                className={cn(
                  "cursor-pointer focus-visible:bg-muted focus-visible:outline-none",
                  closed && "text-muted-foreground",
                  busy && "opacity-60",
                )}
              >
                <TableCell className="pl-4">
                  <div className={cn("truncate font-semibold", closed ? "text-foreground/80" : "text-foreground")}>
                    {p.clientName || "Untitled project"}
                  </div>
                  <div className="label-mono mt-0.5 truncate normal-case">{p.ref || p.id}</div>
                  <div className="mt-1 text-xs text-muted-foreground md:hidden">
                    {projectTypeLabel(p)} · {formatUpdated(p.updated) || "not saved yet"}
                  </div>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {projectTypeLabel(p)}
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {typeof p.policyType === "string" && p.policyType ? p.policyType : "—"}
                </TableCell>
                <TableCell>
                  <ProjectStatusBadge status={status} />
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                  {formatUpdated(p.updated) || "—"}
                </TableCell>
                <TableCell className="text-right" onClick={stop}>
                  {reports ? (
                    <div className="inline-flex items-center gap-0.5">
                      {EXPORT_FORMATS.map((f, i) => (
                        <span key={f.format} className="inline-flex items-center">
                          {i > 0 && <span className="px-0.5 text-ink-3">·</span>}
                          <Button
                            variant="link"
                            size="xs"
                            className="label-mono h-auto px-0.5 text-primary"
                            title={`Download ${f.label}`}
                            aria-label={`Download ${f.label} for ${p.clientName || "project"}`}
                            disabled={busy}
                            onClick={() => onDownload(p, f.format)}
                          >
                            {busy && busyFormat === f.format ? (
                              <LoaderCircle className="size-3 animate-spin" />
                            ) : (
                              f.short
                            )}
                          </Button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="label-mono" title="No presentation generated yet">
                      —
                    </span>
                  )}
                </TableCell>
                <TableCell className="pr-3 text-right" onClick={stop}>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${p.clientName || "project"}`}
                          disabled={busy}
                        />
                      }
                    >
                      <Ellipsis />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="truncate">
                          {p.clientName || "Untitled project"}
                        </DropdownMenuLabel>
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
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
