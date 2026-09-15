"use client";

import { Check, CircleAlert, Download, FileSpreadsheet, LoaderCircle, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { DeckPreview } from "@/components/export/deck-preview";
import { PageHeader } from "@/components/layout/page-header";
import { ProjectScreen } from "@/components/projects/project-screen";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useInsurers } from "@/hooks/use-insurers";
import { useProject } from "@/hooks/use-project";
import { ApiError, errorMessage, presentationApi, projectsApi, type ExportFormat, type ProjectState } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import {
  buildPresentationRequest,
  editStats,
  exportFilename,
  exportSummary,
  generatedAt,
  isSuperseded,
  markGenerated,
} from "@/lib/export";
import { PROJECT_STEPS, routes } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type Phase = "idle" | "pptx" | "pdf" | "saving" | "done" | "error";

const STEPS: { phase: Phase; label: string }[] = [
  { phase: "pptx", label: "Building the PowerPoint" },
  { phase: "pdf", label: "Rendering the PDF" },
  { phase: "saving", label: "Saving to the project" },
];

function stepState(phase: Phase, step: Phase): "done" | "active" | "todo" {
  const order: Phase[] = ["pptx", "pdf", "saving", "done"];
  const i = order.indexOf(step);
  const c = order.indexOf(phase);
  if (phase === "error") return "todo";
  return c > i ? "done" : c === i ? "active" : "todo";
}

function ExportBody({ project }: { project: ProjectState }) {
  const { update } = useProject();
  const { insurers } = useInsurers();
  const summary = exportSummary(project, insurers);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<{ message: string; blocked: boolean } | null>(null);
  const [files, setFiles] = useState<Partial<Record<ExportFormat, Blob>>>({});
  const [downloading, setDownloading] = useState<ExportFormat | null>(null);
  const [previewVersion, setPreviewVersion] = useState(() => generatedAt(project) ?? 0);

  const generated = generatedAt(project);
  const superseded = isSuperseded(project);
  const busy = phase === "pptx" || phase === "pdf" || phase === "saving";
  const canGenerate = summary.blockers.length === 0 && !busy;

  const generate = async () => {
    setError(null);
    const payload = buildPresentationRequest(project, insurers);
    const stats = editStats(project);
    try {
      setPhase("pptx");
      const pptx = await presentationApi.generate("pptx", project.id, payload, stats);
      setPhase("pdf");
      const pdf = await presentationApi.generate("pdf", project.id, payload, stats);
      let xlsx: Blob | undefined;
      if (payload.credit_limits.length) {
        xlsx = (await presentationApi.generate("limits-xlsx", project.id, payload, stats)).blob;
      }
      setFiles({ pptx: pptx.blob, pdf: pdf.blob, ...(xlsx ? { "limits-xlsx": xlsx } : {}) });
      setPhase("saving");
      const next = await update(markGenerated);
      setPreviewVersion(generatedAt(next) ?? Date.now());
      setPhase("done");
      toast.success("Presentation generated");
    } catch (err) {
      const blocked = err instanceof ApiError && err.status === 409;
      setError({ message: errorMessage(err, "Generation failed"), blocked });
      setPhase("error");
    }
  };

  const download = async (format: ExportFormat) => {
    setDownloading(format);
    try {
      const blob = files[format] ?? (await projectsApi.downloadExport(project.id, format)).blob;
      saveBlob(blob, exportFilename(project, format));
    } catch (err) {
      toast.error(errorMessage(err, "Download failed"));
    } finally {
      setDownloading(null);
    }
  };

  const hasFiles = Boolean(generated) || phase === "done";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`Step 6 of ${PROJECT_STEPS.length}`}
        title="Generate and export"
        description="Build the presentation from the reviewed comparison, check the preview, then download. Regenerating replaces the previous files under this project. Nothing is sent from the system."
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── Preview ─────────────────────────────────────────────── */}
        <section className="space-y-4">
          {hasFiles ? (
            <>
              {superseded && (
                <Alert className="border-warn/40 bg-warn-soft text-warn [&>svg]:text-warn">
                  <TriangleAlert />
                  <AlertTitle>Edited since the last generation</AlertTitle>
                  <AlertDescription className="text-warn">
                    The preview and any files downloaded earlier no longer match the project. Regenerate before sending.
                  </AlertDescription>
                </Alert>
              )}
              <DeckPreview projectId={project.id} version={previewVersion} />
            </>
          ) : (
            <div className="rounded-xl border border-dashed bg-card px-6 py-14 text-center">
              <Sparkles className="mx-auto mb-3 size-6 text-primary" />
              <p className="text-sm font-medium">No presentation generated yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Generate it to see every slide here, exactly as it will download.
              </p>
            </div>
          )}
        </section>

        {/* ── Summary + actions ──────────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-20">
          <div className="rounded-xl border bg-card p-4 shadow-card">
            <h2 className="text-sm font-semibold">Presentation summary</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Client</dt>
                <dd className="text-right font-medium">{summary.clientName || <span className="text-warn">not set</span>}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Type</dt>
                <dd className="text-right">{summary.kind === "renewal" ? "Renewal" : "New business"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Front page</dt>
                <dd className="text-right text-xs">{summary.coverTitle}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Insurers included</dt>
                <dd className="mt-0.5">{summary.included.length ? summary.included.join(", ") : <span className="text-warn">none yet</span>}</dd>
              </div>
              {summary.declined.length > 0 && (
                <div>
                  <dt className="text-muted-foreground">Declined to quote</dt>
                  <dd className="mt-0.5">{summary.declined.join(", ")}</dd>
                </div>
              )}
              {summary.hasExpiring && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Expiring policy</dt>
                  <dd>included as baseline</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Recommended</dt>
                <dd className="text-right">{summary.recommended ?? <span className="text-muted-foreground">none</span>}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Credit-limit buyers</dt>
                <dd>{summary.buyerCount ? summary.buyerCount : <span className="text-muted-foreground">0 · page omitted</span>}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Key values confirmed</dt>
                <dd className={cn(summary.confirmedCount === 4 ? "text-ok" : "text-warn")}>{summary.confirmedCount} of 4</dd>
              </div>
            </dl>
          </div>

          {summary.blockers.length > 0 && (
            <Alert className="border-warn/40 bg-warn-soft [&>svg]:text-warn">
              <CircleAlert />
              <AlertTitle className="text-warn">Before generating</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 text-warn">
                  {summary.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="rounded-xl border bg-card p-4 shadow-card">
            <Button size="lg" className="w-full" disabled={!canGenerate} onClick={generate}>
              {busy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : hasFiles ? <RefreshCw data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
              {busy ? "Generating…" : hasFiles ? "Regenerate presentation" : "Generate presentation"}
            </Button>

            {(busy || phase === "done") && (
              <ol className="mt-3 space-y-1.5" aria-live="polite">
                {STEPS.map((s) => {
                  const st = stepState(phase, s.phase);
                  return (
                    <li key={s.phase} className={cn("flex items-center gap-2 text-xs", st === "todo" ? "text-ink-3" : st === "active" ? "text-foreground" : "text-ok")}>
                      {st === "done" ? <Check className="size-3.5" /> : st === "active" ? <LoaderCircle className="size-3.5 animate-spin" /> : <span className="size-3.5 rounded-full border" />}
                      {s.label}
                    </li>
                  );
                })}
              </ol>
            )}

            {phase === "error" && error && (
              <Alert variant="destructive" className="mt-3">
                <CircleAlert />
                <AlertTitle>{error.blocked ? "Export blocked" : "Generation failed"}</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{error.message}</p>
                  <div className="flex flex-wrap gap-2">
                    {!error.blocked && (
                      <Button size="sm" variant="outline" onClick={generate}>
                        Try again
                      </Button>
                    )}
                    <Button size="sm" variant="outline" nativeButton={false} render={<Link href={routes.projectStep(project.id, "review")} />}>
                      Go to Review
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <div className="mt-4 space-y-2">
              <Button variant={hasFiles ? "default" : "outline"} className="w-full" disabled={!hasFiles || busy || downloading !== null} onClick={() => download("pptx")}>
                {downloading === "pptx" ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
                Download PowerPoint
              </Button>
              <Button variant="outline" className="w-full" disabled={!hasFiles || busy || downloading !== null} onClick={() => download("pdf")}>
                {downloading === "pdf" ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
                Download PDF
              </Button>
              {summary.buyerCount > 0 && (
                <Button variant="ghost" size="sm" className="w-full" disabled={!hasFiles || busy || downloading !== null} onClick={() => download("limits-xlsx")}>
                  {downloading === "limits-xlsx" ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <FileSpreadsheet data-icon="inline-start" />}
                  Credit limits as Excel
                </Button>
              )}
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              {hasFiles
                ? `File name: ${exportFilename(project, "pptx")}`
                : "PowerPoint (editable, Google Slides compatible) and PDF of the same deck."}
            </p>
            {generated && (
              <p className="mt-1 text-xs text-muted-foreground">
                Last generated {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(generated))}
                {superseded ? " · edited since" : ""}
              </p>
            )}
          </div>

          <Button variant="outline" className="w-full" nativeButton={false} render={<Link href={routes.projectStep(project.id, "recommend")} />}>
            Back to recommendation
          </Button>
        </aside>
      </div>
    </div>
  );
}

/** S8 — Generate and export. Client boundary for the page. */
export function ExportScreen() {
  return <ProjectScreen>{(project) => <ExportBody key={project.id} project={project} />}</ProjectScreen>;
}
