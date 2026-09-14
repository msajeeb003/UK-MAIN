"use client";

import { ArrowRight, RefreshCw, Table2, Upload } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { ProjectScreen } from "@/components/projects/project-screen";
import { Button } from "@/components/ui/button";
import { FileList } from "@/components/upload/file-list";
import { UploadDropzone } from "@/components/upload/upload-dropzone";
import { useUploadQueue } from "@/hooks/use-upload-queue";
import type { DocKind, ProjectState } from "@/lib/api/types";
import { MAX_QUOTES } from "@/lib/fields";
import { PROJECT_STEPS, routes } from "@/lib/navigation";
import { DOC_KIND_META, isInFlight, projectFiles, quoteSlotsUsed, type ProjectFile, type UploadProjectState } from "@/lib/uploads";

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
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Step 2 of ${PROJECT_STEPS.length}`}
        title="Upload documents"
        description="Add quotes as they arrive. Uploads are cumulative: each new document updates the comparison, and the presentation can be regenerated with whatever has arrived."
      />

      <div className={isRenewal ? "grid gap-4 md:grid-cols-3" : "grid gap-4 md:grid-cols-2"}>
        <UploadDropzone
          title={DOC_KIND_META.quote.title}
          hint={DOC_KIND_META.quote.hint}
          accept={DOC_KIND_META.quote.accept}
          multiple
          tone="accent"
          icon={<Upload className="size-5" />}
          disabled={quotesFull}
          disabledReason={`All ${MAX_QUOTES} quote slots are used. Remove an unreadable one to add another.`}
          footer={`${used} of ${MAX_QUOTES} used`}
          onFiles={drop("quote")}
        />
        <UploadDropzone
          title={DOC_KIND_META.limits.title}
          hint={DOC_KIND_META.limits.hint}
          accept={DOC_KIND_META.limits.accept}
          multiple
          icon={<Table2 className="size-5" />}
          onFiles={drop("limits")}
        />
        {isRenewal && (
          <UploadDropzone
            title={DOC_KIND_META.expiring.title}
            hint={hasExpiring ? "Uploaded. Choosing another file replaces it." : "Required for a renewal: the comparison baseline."}
            accept={DOC_KIND_META.expiring.accept}
            multiple={false}
            tone="warn"
            icon={<RefreshCw className="size-5" />}
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

      <p className="text-xs text-muted-foreground">
        An unreadable document is flagged individually; the project continues with that insurer&apos;s
        column blank. Processing takes one to two minutes for a full set; you can leave this screen and
        come back, the status keeps updating.
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" nativeButton={false} render={<Link href={routes.projectStep(p.id, "setup")} />}>
          Back to setup
        </Button>
        <div className="flex items-center gap-3">
          {extractedQuotes === 0 && inFlight === 0 && (
            <span className="text-xs text-muted-foreground">Upload at least one quote to review the comparison.</span>
          )}
          {isRenewal && !hasExpiring && extractedQuotes > 0 && (
            <span className="text-xs text-warn">The expiring policy is still missing.</span>
          )}
          <Button
            nativeButton={false}
            render={<Link href={routes.projectStep(p.id, "review")} />}
            disabled={extractedQuotes === 0}
          >
            Review comparison
            <ArrowRight data-icon="inline-end" />
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
