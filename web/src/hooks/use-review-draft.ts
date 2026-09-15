"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useProject } from "@/hooks/use-project";
import { errorMessage, type ProjectState } from "@/lib/api";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 700;

type WithId = { id?: unknown };

/** Draft items in draft order, then server items the draft has not seen. */
function mergeById(server: unknown[] | undefined, draft: unknown[] | undefined): unknown[] {
  const mine = Array.isArray(draft) ? draft : [];
  const theirs = Array.isArray(server) ? server : [];
  const known = new Set(mine.map((x) => (x as WithId)?.id));
  return [...mine, ...theirs.filter((x) => !known.has((x as WithId)?.id))];
}

/** Keys the review screen owns; everything else is left to the latest saved copy. */
const REVIEW_KEYS = ["columns", "credit", "limitsHidden", "files", "confirmed", "reviewed", "reviewedAt", "notes", "manualSeq", "recommended", "reasons", "keyDifferences", "updated"] as const;

/**
 * Local working copy of the project for a busy editing screen. Mutations
 * apply instantly to the draft; the save is debounced and merged into the
 * latest project state through the provider's serialised `update`, so
 * typing never floods the backend and concurrent upload results are not
 * overwritten.
 */
export function useReviewDraft(initial: ProjectState) {
  const { update } = useProject();
  const [draft, setDraft] = useState<ProjectState>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const draftRef = useRef(draft);
  const timer = useRef<number | null>(null);
  const pending = useRef(false);

  const persist = useCallback(async () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!pending.current) return;
    pending.current = false;
    setSaveState("saving");
    const snapshot = draftRef.current;
    try {
      await update((current) => {
        const merged: ProjectState = { ...current };
        for (const key of REVIEW_KEYS) {
          if (!(key in snapshot)) continue;
          if (key === "columns" || key === "credit" || key === "files") {
            // The pipeline may have added a column / buyer row / card since
            // the draft was taken: keep server-only items, let the draft's
            // version win for items it knows.
            (merged as Record<string, unknown>)[key] = mergeById(
              current[key] as unknown[] | undefined,
              snapshot[key] as unknown[] | undefined,
            );
          } else {
            (merged as Record<string, unknown>)[key] = snapshot[key];
          }
        }
        return merged;
      });
      setSaveState(pending.current ? "dirty" : "saved");
    } catch (err) {
      pending.current = true;
      setSaveState("error");
      toast.error(errorMessage(err, "Could not save your edits"));
    }
  }, [update]);

  const commit = useCallback(
    (fn: (current: ProjectState) => ProjectState) => {
      const next = fn(draftRef.current);
      draftRef.current = next;
      setDraft(next);
      pending.current = true;
      setSaveState("dirty");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void persist(), DEBOUNCE_MS);
    },
    [persist],
  );

  // Flush on unmount / tab close so the last keystrokes are not lost.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current) {
        void persist();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (pending.current) void persist();
    };
  }, [persist]);

  return { draft, commit, saveState, flush: persist };
}
