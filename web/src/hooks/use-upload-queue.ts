"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useProject } from "@/hooks/use-project";
import { ApiError, documentsApi, errorMessage, extractionApi, type DocKind, type ExtractJob } from "@/lib/api";
import { isInFlight, planUploads, projectFiles, type ProjectFile, type UploadProjectState } from "@/lib/uploads";

const POLL_MS = 1500;
const POLL_MAX_MS = 6000;
const JOB_TIMEOUT_MS = 10 * 60_000;

export interface UploadQueue {
  /** Add files to a slot: validates, uploads the batch, then follows each job. */
  enqueue: (kind: DocKind, files: File[]) => Promise<void>;
  /** Drop a failed entry from the list (and its stored document). */
  remove: (entry: ProjectFile) => Promise<void>;
  /** Ids of entries whose extraction is being polled right now. */
  polling: ReadonlySet<string>;
}

/**
 * Upload orchestration for S4. The backend owns the whole lifecycle: the
 * upload creates one record and one upload card per file, a background job
 * per document runs the pipeline and writes its progress, its result (the
 * comparison column / buyer rows) and its card status into the project.
 * This hook only sends the files, follows each job, and reloads the project
 * whenever something changed — it never writes extraction results itself,
 * so a job finishing while the broker works can never be overwritten.
 */
export function useUploadQueue(): UploadQueue {
  const { project, reload } = useProject();
  const [polling, setPolling] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, number>());
  const aborts = useRef(new Map<string, AbortController>());

  const markPolling = useCallback((id: string, on: boolean) => {
    setPolling((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const pollJob = useCallback(
    (entry: ProjectFile, jobId: string) => {
      if (timers.current.has(entry.id)) return;
      markPolling(entry.id, true);
      const controller = new AbortController();
      aborts.current.set(entry.id, controller);
      const startedAt = Date.now();
      let delay = POLL_MS;
      let misses = 0;
      let lastSeen = "";

      const stop = () => {
        const t = timers.current.get(entry.id);
        if (t) window.clearTimeout(t);
        timers.current.delete(entry.id);
        aborts.current.delete(entry.id);
        markPolling(entry.id, false);
      };

      const tick = async () => {
        if (controller.signal.aborted) return stop();
        try {
          const job: ExtractJob = await extractionApi.getJob(jobId, controller.signal);
          misses = 0;
          if (job.status === "done") {
            stop();
            reload();
            toast.success(`${entry.name} extracted`);
            return;
          }
          if (job.status === "error") {
            stop();
            reload();
            toast.error(`${entry.name}: ${job.error || "unreadable"}`);
            return;
          }
          // The worker keeps the card's status/label current in the project;
          // pick it up when the stage changes.
          const seen = `${job.status}:${job.stage}`;
          if (seen !== lastSeen) {
            lastSeen = seen;
            reload();
          }
        } catch (err) {
          if (controller.signal.aborted) return stop();
          if (err instanceof ApiError && err.status === 404) {
            stop();
            reload();
            return;
          }
          // Transient (network, 5xx): back off and keep trying for a while.
          misses += 1;
          delay = Math.min(POLL_MAX_MS, delay * 1.5);
          if (misses >= 8) {
            stop();
            toast.error(`${entry.name}: lost contact with the server (${errorMessage(err)})`);
            return;
          }
        }
        if (Date.now() - startedAt > JOB_TIMEOUT_MS) {
          stop();
          reload();
          return;
        }
        timers.current.set(entry.id, window.setTimeout(tick, delay));
      };

      timers.current.set(entry.id, window.setTimeout(tick, delay));
    },
    [markPolling, reload],
  );

  // Follow every in-flight card (after an upload, a reload, another tab).
  const projectId = project?.id;
  const inFlightKey = project
    ? projectFiles(project as UploadProjectState)
        .filter((f) => isInFlight(f) && f.jobId)
        .map((f) => `${f.id}:${f.jobId}`)
        .join(",")
    : "";
  useEffect(() => {
    if (!project) return;
    for (const f of projectFiles(project as UploadProjectState)) {
      if (isInFlight(f) && f.jobId && !timers.current.has(f.id)) pollJob(f, f.jobId);
    }
    // Re-run when the set of in-flight cards changes, not on every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, inFlightKey, pollJob]);

  // Stop timers on unmount; the cards keep their status in the project and
  // are followed again when the screen is opened.
  useEffect(() => {
    const timerMap = timers.current;
    const abortMap = aborts.current;
    return () => {
      for (const t of timerMap.values()) window.clearTimeout(t);
      timerMap.clear();
      for (const c of abortMap.values()) c.abort();
      abortMap.clear();
    };
  }, []);

  const enqueue = useCallback(
    async (kind: DocKind, files: File[]) => {
      if (!project) return;
      const plan = planUploads(project as UploadProjectState, kind, files);
      if (plan.rejected.length) {
        const lines = plan.rejected.map((r) => `${r.file.name}: ${r.reason}`);
        toast.warning(plan.rejected.length === 1 ? lines[0] : `${plan.rejected.length} files skipped`, {
          description: plan.rejected.length === 1 ? undefined : lines.join("\n"),
        });
      }
      if (plan.retried.length) toast.info(`Retrying ${plan.retried.join(", ")}`);
      if (!plan.accepted.length) return;
      try {
        // One multipart request for the batch; the backend creates the cards
        // and queues the extractions. Reloading shows them (and starts polling).
        const records = await documentsApi.upload(project.id, kind, plan.accepted);
        for (const record of records) {
          if (record.status === "unreadable") toast.error(`${record.filename}: ${record.error || "rejected"}`);
        }
      } catch (err) {
        if (!(err instanceof ApiError && err.isUnauthorized)) toast.error(errorMessage(err, "Upload failed"));
      } finally {
        reload();
      }
    },
    [project, reload],
  );

  const remove = useCallback(
    async (entry: ProjectFile) => {
      if (isInFlight(entry) || !project) return;
      const docId = entry.docId ?? entry.id;
      try {
        await documentsApi.remove(project.id, docId);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) {
          toast.error(errorMessage(err, "Could not remove the document"));
          return;
        }
      }
      reload();
    },
    [project, reload],
  );

  return { enqueue, remove, polling };
}
