"use client";

import { RotateCcw, Trash } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DocKind } from "@/lib/api/types";
import { isInFlight, kindLabel, type FileStatus, type ProjectFile } from "@/lib/uploads";
import { cn } from "@/lib/utils";

/** Wireframe pills: ● Extracted (green), ◐ Processing (grey), ▲ Unreadable (amber). */
const STATUS: Record<FileStatus, { label: string; glyph: string; className: string }> = {
  uploading: { label: "Uploading", glyph: "◐", className: "bg-[#eef1f5] text-ink-2" },
  queued: { label: "Queued", glyph: "◐", className: "bg-[#eef1f5] text-ink-2" },
  processing: { label: "Processing", glyph: "◐", className: "bg-[#eef1f5] text-ink-2" },
  extracted: { label: "Extracted", glyph: "●", className: "bg-ok-soft text-ok" },
  error: { label: "Unreadable", glyph: "▲", className: "bg-warn-soft text-warn" },
};

export function FileStatusPill({ status }: { status: FileStatus }) {
  const s = STATUS[status];
  const busy = isInFlight({ status } as ProjectFile);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-[11px] py-1 text-xs font-medium whitespace-nowrap", s.className)}
      aria-live={busy ? "polite" : undefined}
    >
      <span aria-hidden className={cn(busy && "animate-pulse")}>
        {s.glyph}
      </span>
      {s.label}
    </span>
  );
}

const KIND_LABEL: Record<DocKind, string> = { quote: "Quote", limits: "Credit-limit schedule", expiring: "Expiring policy" };

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

/** The wireframe's Documents card: one row per uploaded file with its live status. */
export function FileList({ files, onRetry, onRemove }: FileListProps) {
  const errors = files.filter((f) => f.status === "error").length;
  const busy = files.filter(isInFlight).length;

  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-line px-[18px] py-[13px] text-[13.5px] font-semibold text-ink">
        <span>Documents</span>
        <span className="font-mono text-[11px] font-medium text-ink-3">
          {files.length} file{files.length === 1 ? "" : "s"}
          {busy ? ` · ${busy} in progress` : ""}
          {errors ? ` · ${errors} unreadable` : ""}
        </span>
      </div>
      {files.length === 0 ? (
        <p className="px-[18px] py-9 text-center text-sm text-ink-2">
          No documents yet. Upload the quotes above; they can be added in any order and at any time.
        </p>
      ) : (
        <ul>
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3.5 border-b border-line-2 px-[18px] py-[13px] last:border-b-0">
              <span
                aria-hidden
                className="grid h-[38px] w-8 shrink-0 place-items-center rounded-[5px] border border-line bg-panel font-mono text-[9px] font-medium text-ink-3"
              >
                {f.ext}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-ink">{f.name}</div>
                <div className="truncate text-[11.5px] text-ink-3">
                  {KIND_LABEL[f.kind] ?? kindLabel(f.kind)}
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
