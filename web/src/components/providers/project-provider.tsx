"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ApiError, errorMessage, projectsApi, type ProjectState } from "@/lib/api";

export type ProjectLoadStatus = "loading" | "ready" | "missing" | "error";

export interface ProjectContextValue {
  projectId: string;
  project: ProjectState | null;
  status: ProjectLoadStatus;
  error: string | null;
  /** Persist a full project state (the backend stores it verbatim). */
  save: (next: ProjectState) => Promise<ProjectState>;
  /**
   * Apply a change to the LATEST project state and persist it. Updates are
   * queued, so concurrent callers (several uploads finishing at once) never
   * overwrite each other with a stale copy.
   */
  update: (fn: (current: ProjectState) => ProjectState) => Promise<ProjectState>;
  reload: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

/**
 * Loads the current project for the /projects/[projectId]/* screens and
 * offers `save` / `update`. The backend has no per-id GET, so the list is
 * fetched and filtered; at the pilot's scale (a few users, tens of
 * projects) that is cheaper than adding an endpoint.
 */
export function ProjectProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [project, setProject] = useState<ProjectState | null>(null);
  const [status, setStatus] = useState<ProjectLoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<ProjectState | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    projectsApi.get(projectId).then(
      (found) => {
        if (cancelled) return;
        latest.current = found;
        setProject(found);
        setStatus("ready");
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          latest.current = null;
          setProject(null);
          setStatus("missing");
          return;
        }
        // A background refresh that fails keeps the copy already on screen;
        // only the first load surfaces the error state.
        if (latest.current) return;
        setError(errorMessage(err, "Could not load the project"));
        setStatus("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, attempt]);

  /**
   * Fetch the latest server copy. While a project is already on screen this
   * is a silent refresh — the screen keeps rendering the current copy and
   * swaps in the new one when it arrives (the upload screen refreshes on
   * every processing step, and must not flash its loading state each time).
   */
  const reload = useCallback(() => {
    if (!latest.current) setStatus("loading");
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const save = useCallback(async (next: ProjectState) => {
    await projectsApi.save(next);
    latest.current = next;
    setProject(next);
    return next;
  }, []);

  const update = useCallback(
    (fn: (current: ProjectState) => ProjectState) => {
      const run = async () => {
        if (!latest.current) throw new Error("Project is not loaded.");
        // Show the change immediately on the local copy…
        const optimistic = fn(latest.current);
        latest.current = optimistic;
        setProject(optimistic);
        // …but persist it against the latest server copy: the backend's
        // pipeline writes columns, buyer rows and upload cards into the same
        // document while the broker works, and must not be overwritten.
        const fresh = await projectsApi.get(projectId);
        const next = fn(fresh);
        const saved = await projectsApi.save(next);
        latest.current = saved;
        setProject(saved);
        return saved;
      };
      const result = chain.current.then(run, run);
      chain.current = result.catch(() => undefined);
      return result;
    },
    [projectId],
  );

  const value = useMemo<ProjectContextValue>(
    () => ({ projectId, project, status, error, save, update, reload }),
    [projectId, project, status, error, save, update, reload],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within <ProjectProvider>");
  return ctx;
}
