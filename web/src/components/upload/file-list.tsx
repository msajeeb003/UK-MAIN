"use client";

import { CircleCheck, LoaderCircle, RotateCcw, Trash, TriangleAlert, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DocKind } from "@/lib/api/types";
import { isInFlight, kindLabel, type FileStatus, type ProjectFile } from "@/lib/uploads";
import { cn } from "@/lib/utils";

const STATUS: Record<FileStatus, { label: string; className: string; Icon: typeof CircleCheck; spin?: boolean }> = {
  uploading: { label: "Uploading", className: "bg-muted text-muted-foreground", Icon: LoaderCircle, spin: true },
  queued: { label: "Queued", className: "bg-muted text-muted-foreground", Icon: Clock },
  processing: { label: "Processing", className: "bg-accent text-accent-foreground", Icon: LoaderCircle, spin: true },
  extracted: { label: "Extracted", className: "bg-ok-soft text-ok", Icon: CircleCheck },
  error: { label: "Unreadable", className: "bg-warn-soft text-warn", Icon: TriangleAlert },
};

export function FileStatusPill({ status }: { status: FileStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", s.className)}
      aria-live={isInFlight({ status } as ProjectFile) ? "polite" : undefined}
    >
      <s.Icon className={cn("size-3", s.spin && "animate-spin")} />
      {s.label}
    </span>
  );
}

const KIND_LABEL: Record<DocKind, string> = { quote: "Quote", limits: "Credit limits", expiring: "Expiring policy" };

/** In-flight and error metas start with the kind label, which the row already shows. */
function stripKindPrefix(f: ProjectFile): string {
  const prefix = `${kindLabel(f.kind)} · `;
  return f.meta.startsWith(prefix) ? f.meta.slice(prefix.length) : f.meta;
}

interface FileListProps {
  files: ProjectFile[];
  onRetry: (entry: ProjectFile) => void;
  onRemove: (entry: ProjectFile) => void;
}

/** The documents card: one row per uploaded file with its live status. */
export function FileList({ files, onRetry, onRemove }: FileListProps) {
  const errors = files.filter((f) => f.status === "error").length;
  const busy = files.filter(isInFlight).length;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-semibold">Documents</span>
        <span className="label-mono normal-case">
          {files.length} file{files.length === 1 ? "" : "s"}
          {busy ? ` · ${busy} in progress` : ""}
          {errors ? ` · ${errors} unreadable` : ""}
        </span>
      </div>
      {files.length === 0 ? (
        <p className="px-4 py-9 text-center text-sm text-muted-foreground">
          No documents yet. Upload the quotes above; they can be added in any order and at any time.
        </p>
      ) : (
        <ul className="divide-y divide-line-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3.5 px-4 py-3">
              <span
                aria-hidden
                className="label-mono grid h-9 w-8 shrink-0 place-items-center rounded border bg-panel text-[9px]"
              >
                {f.ext}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{f.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  <span className="text-ink-3">{KIND_LABEL[f.kind] ?? kindLabel(f.kind)}</span>
                  {f.meta ? ` · ${stripKindPrefix(f)}` : ""}
                </div>
              </div>
              <FileStatusPill status={f.status} />
              {f.status === "error" && (
                <div className="flex items-center gap-0.5">
                  <Button variant="ghost" size="icon-sm" aria-label={`Retry ${f.name}`} title="Upload again" onClick={() => onRetry(f)}>
                    <RotateCcw />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => onRemove(f)}>
                    <Trash />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
