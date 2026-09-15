"use client";

import { FolderKanban, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ProjectsTable } from "@/components/projects/projects-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, projectsApi, type ExportFormat, type ProjectState } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { routes } from "@/lib/navigation";
import {
  closeProject,
  newProjectState,
  reopenProject,
  updatedTimestamp,
  type ProjectTypeFilter,
} from "@/lib/projects";
import { cn } from "@/lib/utils";

const TYPE_FILTERS: { value: ProjectTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New business" },
  { value: "renewal", label: "Renewal" },
];

/**
 * S2 — Projects (wireframe): title, "New project", a client-name search
 * with All / New business / Renewal chips, and the project rows, most
 * recently updated first. An existing project reopens on its review
 * screen; a new one starts at setup.
 */
export function ProjectsList() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ProjectTypeFilter>("all");
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
    return projects
      .filter((p) => {
        if (q && !String(p.clientName ?? "").toLowerCase().includes(q) && !String(p.ref ?? "").toLowerCase().includes(q)) return false;
        if (typeFilter === "renewal" && p.projectType !== "renewal") return false;
        if (typeFilter === "new" && p.projectType === "renewal") return false;
        return true;
      })
      .sort((a, b) => updatedTimestamp(b) - updatedTimestamp(a));
  }, [projects, search, typeFilter]);

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

  const close = (p: ProjectState) => persist(closeProject(p), `${p.clientName || "Project"} closed`);

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

  const filtering = Boolean(search.trim()) || typeFilter !== "all";

  return (
    <>
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-1.5 text-[27px] font-bold tracking-[-0.5px] text-ink">Projects</h1>
          <p className="text-[13.5px] text-ink-2">Client comparisons prepared on this desk.</p>
        </div>
        <Button onClick={createProject} disabled={creating} className="h-10 px-4">
          <Plus className="size-[15px]" strokeWidth={2.4} />
          New project
        </Button>
      </div>

      <div className="mb-4 flex flex-col gap-2.5 sm:flex-row">
        <label className="flex flex-1 items-center gap-[9px] rounded-[9px] border border-line bg-surface px-[13px] py-[9px] focus-within:border-primary focus-within:ring-3 focus-within:ring-accent">
          <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
          <input
            placeholder="Search by client name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search projects by client name"
            className="w-full min-w-0 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3"
          />
        </label>
        <div className="flex gap-1.5" role="group" aria-label="Filter by type">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={typeFilter === f.value}
              onClick={() => setTypeFilter(f.value)}
              className={cn(
                "rounded-[9px] border border-line bg-surface px-[13px] py-[9px] text-[12.5px] transition-colors hover:text-ink",
                typeFilter === f.value ? "font-medium text-ink" : "text-ink-2",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-4 rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {!error && projects === null && (
        <div className="space-y-2 rounded-[14px] border border-line bg-surface p-4 shadow-card">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      )}

      {projects && !visible.length && (
        <div className="flex flex-col items-center gap-3 rounded-[14px] border border-dashed border-line bg-surface px-6 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-accent text-primary">
            <FolderKanban className="size-6" />
          </span>
          <div className="space-y-1">
            <p className="font-medium text-ink">{filtering ? "No projects match" : "No projects yet"}</p>
            <p className="text-sm text-ink-2">
              {filtering ? "Try a different client name or clear the filters." : "Create your first comparison to get started."}
            </p>
          </div>
          {filtering ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch("");
                setTypeFilter("all");
              }}
            >
              Clear filters
            </Button>
          ) : (
            <Button onClick={createProject} disabled={creating} className="h-10 px-4">
              <Plus className="size-[15px]" strokeWidth={2.4} />
              New project
            </Button>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <ProjectsTable
          projects={visible}
          busyId={busyId}
          busyFormat={busyFormat}
          onOpen={openProject}
          onReopen={reopen}
          onClose={close}
          onDownload={download}
        />
      )}
    </>
  );
}
