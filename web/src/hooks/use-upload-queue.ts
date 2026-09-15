"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useProject } from "@/hooks/use-project";
import { ApiError, documentsApi, errorMessage, extractionApi, type DocKind, type DocumentRecord, type ExtractJob } from "@/lib/api";
import {
  addFileEntry,
  applyExtraction,
  isInFlight,
  kindLabel,
  planUploads,
  projectFiles,
  removeFileEntry,
  updateFileEntry,
  type ProjectFile,
  type UploadProjectState,
} from "@/lib/uploads";

const POLL_MS = 1500;
const POLL_MAX_MS = 6000;
const JOB_TIMEOUT_MS = 10 * 60_000;

export interface UploadQueue {
  /** Add files to a slot: validates, records entries, uploads, then polls. */
  enqueue: (kind: DocKind, files: File[]) => Promise<void>;
  /** Drop a failed entry from the list. */
  remove: (entry: ProjectFile) => Promise<void>;
  /** Ids of entries whose extraction is being polled right now. */
  polling: ReadonlySet<string>;
}

function stageLabel(job: ExtractJob): string {
  if (job.status === "queued") return "queued · waiting for a slot";
  if (job.stage === "extracting") return "processing · reading and extracting";
  return job.status;
}

/**
 * Upload orchestration for S4. Each file becomes an entry in the project's
 * `files` list at once (so the list survives navigation and reloads), the
 * file is posted to `/extract-jobs`, and the job is polled until it finishes;
 * the result is folded into the comparison with `applyExtraction`. Entries
 * still in flight when the screen mounts (a reload, another tab) resume
 * polling automatically.
 */
export function useUploadQueue(): UploadQueue {
  const { project, update } = useProject();
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

  const finishError = useCallback(
    async (entry: ProjectFile, message: string) => {
      await update((p) =>
        updateFileEntry(p as UploadProjectState, entry.id, {
          status: "error",
          meta: `${kindLabel(entry.kind)} · ${message}`,
          jobId: null,
          progress: undefined,
        }),
      );
    },
    [update],
  );

  const pollJob = useCallback(
    (entry: ProjectFile, jobId: string) => {
      if (timers.current.has(entry.id)) return;
      markPolling(entry.id, true);
      const controller = new AbortController();
      aborts.current.set(entry.id, controller);
      const startedAt = Date.now();
      let delay = POLL_MS;
      let misses = 0;

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
          const job = await extractionApi.getJob(jobId, controller.signal);
          misses = 0;
          if (job.status === "done" && job.result) {
            stop();
            const result = job.result;
            await update((p) => applyExtraction(p as UploadProjectState, entry.id, result, entry.kind));
            toast.success(`${entry.name} extracted`);
            return;
          }
          if (job.status === "error") {
            stop();
            await finishError(entry, job.error || "extraction failed");
            toast.error(`${entry.name}: ${job.error || "extraction failed"}`);
            return;
          }
          const label = stageLabel(job);
          await update((p) => {
            const current = projectFiles(p as UploadProjectState).find((f) => f.id === entry.id);
            if (!current || current.meta.endsWith(label)) return p;
            return updateFileEntry(p as UploadProjectState, entry.id, {
              status: job.status === "queued" ? "queued" : "processing",
              meta: `${kindLabel(entry.kind)} · ${label}`,
            });
          });
        } catch (err) {
          if (controller.signal.aborted) return stop();
          if (err instanceof ApiError && err.status === 404) {
            stop();
            await finishError(entry, "job expired on the server; upload the file again");
            return;
          }
          // Transient (network, 5xx): back off and keep trying for a while.
          misses += 1;
          delay = Math.min(POLL_MAX_MS, delay * 1.5);
          if (misses >= 8) {
            stop();
            await finishError(entry, `lost contact with the server (${errorMessage(err)})`);
            return;
          }
        }
        if (Date.now() - startedAt > JOB_TIMEOUT_MS) {
          stop();
          await finishError(entry, "timed out after 10 minutes; try again");
          return;
        }
        timers.current.set(entry.id, window.setTimeout(tick, delay));
      };

      timers.current.set(entry.id, window.setTimeout(tick, delay));
    },
    [finishError, markPolling, update],
  );

  // Resume polling for entries that were in flight when this screen mounted.
  const projectId = project?.id;
  useEffect(() => {
    if (!project) return;
    for (const f of projectFiles(project as UploadProjectState)) {
      if ((f.status === "queued" || f.status === "processing") && f.jobId && !timers.current.has(f.id)) {
        pollJob(f, f.jobId);
      }
    }
    // Only re-run when the project identity changes, not on every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, pollJob]);

  // Stop timers on unmount; the entries stay "processing" in the saved
  // state and resume when the screen is opened again.
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

  /**
   * One request for the whole batch (POST /projects/{id}/documents): each
   * file gets a list entry first so the cards show at once and survive a
   * reload, then the server's per-file records decide what happens next —
   * poll the job for accepted files, flag rejected ones.
   */
  const uploadBatch = useCallback(
    async (kind: DocKind, files: File[]) => {
      const entries: ProjectFile[] = [];
      let projectId = "";
      for (const file of files) {
        const withEntry = await update((p) => {
          const { project: next, entry } = addFileEntry(p as UploadProjectState, kind, file);
          entries.push(entry);
          return next;
        });
        projectId = withEntry.id;
      }
      let records: DocumentRecord[];
      try {
        records = await documentsApi.upload(projectId, kind, files);
      } catch (err) {
        // 401/403 already routed to the login page by the API client; the
        // documents are fine, so drop the cards instead of flagging them.
        if (err instanceof ApiError && err.isUnauthorized) {
          for (const entry of entries) {
            await update((p) => removeFileEntry(p as UploadProjectState, entry.id)).catch(() => undefined);
          }
          return;
        }
        const message = errorMessage(err, "upload failed");
        for (const entry of entries) await finishError(entry, message);
        return;
      }
      for (const [i, entry] of entries.entries()) {
        const record = records[i];
        if (!record || record.status === "failed" || !record.job_id) {
          const reason = record?.error || "rejected by the server";
          await finishError(entry, reason);
          toast.error(`${entry.name}: ${reason}`);
          continue;
        }
        const processing = record.status === "processing";
        await update((p) =>
          updateFileEntry(p as UploadProjectState, entry.id, {
            status: processing ? "processing" : "queued",
            meta: `${kindLabel(kind)} · ${processing ? "processing · reading and extracting" : "queued · waiting for a slot"}`,
            jobId: record.job_id,
            docId: record.id,
            progress: undefined,
          }),
        );
        pollJob(entry, record.job_id);
      }
    },
    [finishError, pollJob, update],
  );

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
      // One multipart request for the batch; the backend queues the extractions.
      if (plan.accepted.length) await uploadBatch(kind, plan.accepted);
    },
    [project, uploadBatch],
  );

  const remove = useCallback(
    async (entry: ProjectFile) => {
      if (isInFlight(entry)) return;
      if (entry.docId && project) {
        try {
          await documentsApi.remove(project.id, entry.docId);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) {
            toast.error(errorMessage(err, "Could not remove the document"));
            return;
          }
        }
      }
      await update((p) => removeFileEntry(p as UploadProjectState, entry.id));
    },
    [project, update],
  );

  return { enqueue, remove, polling };
}
