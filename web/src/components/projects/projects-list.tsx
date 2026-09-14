"use client";

import { FolderKanban, Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { ProjectsTable, type SortDir, type SortKey } from "@/components/projects/projects-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, projectsApi, type ExportFormat, type ProjectState } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { routes } from "@/lib/navigation";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_META,
  closeProject,
  isClosed,
  newProjectState,
  projectStatus,
  reopenProject,
  updatedTimestamp,
  type ProjectStatus,
  type ProjectTypeFilter,
} from "@/lib/projects";
import { cn } from "@/lib/utils";

const TYPE_FILTERS: { value: ProjectTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New business" },
  { value: "renewal", label: "Renewal" },
];

type StatusFilter = "all" | ProjectStatus;

function compare(a: ProjectState, b: ProjectState, key: SortKey): number {
  switch (key) {
    case "client":
      return (a.clientName || "").localeCompare(b.clientName || "", undefined, {
        sensitivity: "base",
      });
    case "status":
      return PROJECT_STATUSES.indexOf(projectStatus(a)) - PROJECT_STATUSES.indexOf(projectStatus(b));
    case "updated":
    default:
      return updatedTimestamp(a) - updatedTimestamp(b);
  }
}

/**
 * S2 — Project list. Search by client name, type and status filters, a
 * sortable table with status indicators, download links for generated
 * reports, and close/reopen. Existing projects open on the review screen
 * (S5); a new project starts at setup (S3).
 */
export function ProjectsList() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ProjectTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "updated", dir: "desc" });
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyFormat, setBusyFormat] = useState<ExportFormat | null>(null);

  useEffect(() => {
    let cancelled = false;
    projectsApi.list().then(
      (list) => {
        if (!cancelled) setProjects(list);
      },
      (err: unknown) => {
        if (!cancelled) setError(errorMessage(err, "Could not load projects"));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => {
    setError(null);
    setProjects(null);
    setAttempt((n) => n + 1);
  };

  const visible = useMemo(() => {
    if (!projects) return [];
    const q = search.trim().toLowerCase();
    const filtered = projects.filter((p) => {
      if (q && !String(p.clientName ?? "").toLowerCase().includes(q)
        && !String(p.ref ?? "").toLowerCase().includes(q)) return false;
      if (typeFilter === "renewal" && p.projectType !== "renewal") return false;
      if (typeFilter === "new" && p.projectType === "renewal") return false;
      if (statusFilter !== "all" && projectStatus(p) !== statusFilter) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => compare(a, b, sort.key) * dir || updatedTimestamp(b) - updatedTimestamp(a));
  }, [projects, search, typeFilter, statusFilter, sort]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: 0, draft: 0, ready: 0, sent: 0, closed: 0 };
    for (const p of projects ?? []) {
      c.all += 1;
      c[projectStatus(p)] += 1;
    }
    return c;
  }, [projects]);

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "updated" ? "desc" : "asc" },
    );

  const replaceProject = useCallback((next: ProjectState) => {
    setProjects((list) => (list ? list.map((p) => (p.id === next.id ? next : p)) : list));
  }, []);

  const createProject = async () => {
    setCreating(true);
    const state = newProjectState();
    try {
      await projectsApi.save(state);
      router.push(routes.projectStep(state.id, "setup"));
    } catch (err) {
      toast.error(errorMessage(err, "Could not create the project"));
      setCreating(false);
    }
  };

  /** BRD S2: an existing project reopens on its review screen. */
  const openProject = (p: ProjectState) => router.push(routes.projectStep(p.id, "review"));

  const persist = async (next: ProjectState, successMessage: string) => {
    setBusyId(next.id);
    try {
      await projectsApi.save(next);
      replaceProject(next);
      toast.success(successMessage);
      return true;
    } catch (err) {
      toast.error(errorMessage(err, "Could not update the project"));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const reopen = async (p: ProjectState) => {
    const next = reopenProject(p);
    if (await persist(next, `${p.clientName || "Project"} reopened`)) openProject(next);
  };

  const close = (p: ProjectState) =>
    persist(closeProject(p), `${p.clientName || "Project"} closed`);

  const download = async (p: ProjectState, format: ExportFormat) => {
    setBusyId(p.id);
    setBusyFormat(format);
    try {
      const file = await projectsApi.downloadExport(p.id, format);
      saveBlob(file.blob, file.filename);
    } catch (err) {
      toast.error(errorMessage(err, "Download failed"));
    } finally {
      setBusyId(null);
      setBusyFormat(null);
    }
  };

  const filtering = Boolean(search.trim()) || typeFilter !== "all" || statusFilter !== "all";

  return (
    <>
      <PageHeader
        title="Projects"
        description="Client comparisons prepared on this desk. Open a project to return to its review screen."
        actions={
          <Button onClick={createProject} disabled={creating}>
            <Plus data-icon="inline-start" />
            New project
          </Button>
        }
      />

      {/* Search + filters (wireframe: search by client name, All / New business / Renewal) */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by client name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9 pl-9"
            aria-label="Search projects by client name"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
          {TYPE_FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={typeFilter === f.value ? "secondary" : "outline"}
              size="sm"
              aria-pressed={typeFilter === f.value}
              onClick={() => setTypeFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
        {(["all", ...PROJECT_STATUSES] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={statusFilter === s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              statusFilter === s
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {s === "all" ? "All statuses" : PROJECT_STATUS_META[s].label}
            <span className="label-mono">{counts[s]}</span>
          </button>
        ))}
      </div>

      {error && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={retry}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {!error && projects === null && (
        <div className="space-y-2 rounded-xl border bg-card p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      )}

      {projects && !visible.length && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground">
              <FolderKanban className="size-6" />
            </span>
            <div className="space-y-1">
              <p className="font-medium">{filtering ? "No projects match" : "No projects yet"}</p>
              <p className="text-sm text-muted-foreground">
                {filtering
                  ? "Try a different client name or clear the filters."
                  : "Create your first comparison to get started."}
              </p>
            </div>
            {filtering ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setTypeFilter("all");
                  setStatusFilter("all");
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button onClick={createProject} disabled={creating}>
                <Plus data-icon="inline-start" />
                New project
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {visible.length > 0 && (
        <>
          <ProjectsTable
            projects={visible}
            sort={sort}
            onSort={onSort}
            busyId={busyId}
            busyFormat={busyFormat}
            onOpen={openProject}
            onReopen={reopen}
            onClose={close}
            onDownload={download}
          />
          <p className="text-xs text-muted-foreground">
            {visible.length} of {projects?.length ?? 0} projects
            {visible.some(isClosed) && " · closed projects can be reopened from the row menu"}
          </p>
        </>
      )}
    </>
  );
}
