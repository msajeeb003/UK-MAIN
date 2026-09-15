"use client";

import Link from "next/link";
import { useRef } from "react";

import { ProjectScreen } from "@/components/projects/project-screen";
import { Button } from "@/components/ui/button";
import { FileList } from "@/components/upload/file-list";
import { UploadDropzone } from "@/components/upload/upload-dropzone";
import { useUploadQueue } from "@/hooks/use-upload-queue";
import type { DocKind, ProjectState } from "@/lib/api/types";
import { MAX_QUOTES } from "@/lib/fields";
import { routes } from "@/lib/navigation";
import { DOC_KIND_META, isInFlight, projectFiles, quoteSlotsUsed, type ProjectFile, type UploadProjectState } from "@/lib/uploads";

/** Wireframe tile icons (inline so they match the mock's stroke weights). */
const QuoteIcon = () => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 15V7m0 0l-3 3m3-3l3 3" />
    <path d="M20 16.5A3.8 3.8 0 0017.5 9.6 5.5 5.5 0 006.3 11 4 4 0 005 18.9" />
  </svg>
);
const LimitsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M3 9.5h18M9 4.5v15" />
  </svg>
);
const ExpiringIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20.5 12a8.5 8.5 0 11-2.6-6.1M20.5 4v5h-5" />
  </svg>
);

function UploadBody({ project }: { project: ProjectState }) {
  const p = project as UploadProjectState;
  const { enqueue, remove } = useUploadQueue();
  const retryInput = useRef<HTMLInputElement>(null);
  const retryFor = useRef<ProjectFile | null>(null);

  const isRenewal = p.projectType === "renewal";
  const files = projectFiles(p);
  const used = quoteSlotsUsed(p);
  const quotesFull = used >= MAX_QUOTES;
  const extractedQuotes = files.filter((f) => f.kind === "quote" && f.status === "extracted").length;
  const hasExpiring = files.some((f) => f.kind === "expiring" && f.status === "extracted");
  const inFlight = files.filter(isInFlight).length;

  const onRetry = (entry: ProjectFile) => {
    retryFor.current = entry;
    if (retryInput.current) {
      retryInput.current.accept = DOC_KIND_META[entry.kind].accept;
      retryInput.current.click();
    }
  };

  const drop = (kind: DocKind) => (chosen: File[]) => void enqueue(kind, chosen);

  return (
    <div className="max-w-[900px]">
      <h1 className="mb-1.5 text-[26px] font-bold tracking-[-0.4px] text-ink">Upload documents</h1>
      <p className="mb-6 text-[13.5px] text-ink-2">
        Add quotes as they arrive — uploads are cumulative and the comparison refreshes each time.
      </p>

      <div className={isRenewal ? "mb-6 grid gap-4 md:grid-cols-3" : "mb-6 grid gap-4 md:grid-cols-2"}>
        <UploadDropzone
          title="Quotes"
          hint={`PDF, incl. scanned. Up to ${MAX_QUOTES}.`}
          accept={DOC_KIND_META.quote.accept}
          multiple
          tone="accent"
          icon={<QuoteIcon />}
          disabled={quotesFull}
          disabledReason={`All ${MAX_QUOTES} quote slots are used. Remove an unreadable one to add another.`}
          onFiles={drop("quote")}
        />
        <UploadDropzone
          title="Credit-limit docs"
          hint="PDF or Excel. Optional."
          accept={DOC_KIND_META.limits.accept}
          multiple
          icon={<LimitsIcon />}
          onFiles={drop("limits")}
        />
        {isRenewal && (
          <UploadDropzone
            title="Expiring policy"
            hint={hasExpiring ? "Uploaded. Choosing another file replaces it." : "Required for renewal."}
            accept={DOC_KIND_META.expiring.accept}
            multiple={false}
            tone="warn"
            icon={<ExpiringIcon />}
            onFiles={drop("expiring")}
          />
        )}
      </div>

      {/* Hidden picker used by the per-row Retry action. */}
      <input
        ref={retryInput}
        type="file"
        hidden
        onChange={(e) => {
          const entry = retryFor.current;
          const chosen = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          if (entry && chosen.length) void enqueue(entry.kind, chosen.slice(0, 1));
        }}
      />

      <FileList files={files} onRetry={onRetry} onRemove={(entry) => void remove(entry)} />

      <p className="mx-0.5 mt-3.5 text-[12.5px] text-ink-2">
        An unreadable document is flagged individually — the project continues with that insurer’s column blank.
        {inFlight > 0 && " Processing takes one to two minutes for a full set; you can leave this screen and come back."}
      </p>

      <div className="mt-[22px] flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" nativeButton={false} render={<Link href={routes.projectStep(p.id, "setup")} />}>
          ← Back
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {extractedQuotes === 0 && inFlight === 0 && (
            <span className="text-xs text-ink-2">Upload at least one quote to review the comparison.</span>
          )}
          {isRenewal && !hasExpiring && extractedQuotes > 0 && <span className="text-xs text-warn">The expiring policy is still missing.</span>}
          <Button nativeButton={false} render={<Link href={routes.projectStep(p.id, "review")} />} disabled={extractedQuotes === 0}>
            Review comparison →
          </Button>
        </div>
      </div>
    </div>
  );
}

/** S4 — Upload. Client boundary for the page. */
export function UploadScreen() {
  return <ProjectScreen>{(project) => <UploadBody key={project.id} project={project} />}</ProjectScreen>;
}
