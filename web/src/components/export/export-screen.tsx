"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { DeckPreview, DeckSkeleton } from "@/components/export/deck-preview";
import { ProjectScreen } from "@/components/projects/project-screen";
import { MiniGrid } from "@/components/recommend/mini-grid";
import { useInsurers } from "@/hooks/use-insurers";
import { useProject } from "@/hooks/use-project";
import { ApiError, errorMessage, presentationApi, type ExportFormat, type ProjectState } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { buildPresentationRequest, editStats, exportFilename, exportSummary, generatedAt, isSuperseded, markGenerated } from "@/lib/export";
import { routes } from "@/lib/navigation";
import { formatUpdatedFull } from "@/lib/projects";
import { cn } from "@/lib/utils";

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
  </svg>
);

type Busy = "preview" | ExportFormat | null;

/**
 * S8 — Generate & export. The left side shows the presentation itself:
 * as soon as the gate passes the deck is generated (PowerPoint, PDF and,
 * with buyer limits, the limits workbook — all retained against the
 * project) and its pages are shown from the PDF the broker downloads.
 * Editing the project afterwards flags the preview as out of date;
 * "Refresh preview" or either download regenerates and replaces the
 * previous export. Until the gate passes, a mock-up of the cover,
 * important-information and terms pages stands in. Nothing is sent from
 * the system.
 */
function ExportBody({ project }: { project: ProjectState }) {
  const { update } = useProject();
  const { insurers } = useInsurers();
  const summary = exportSummary(project, insurers);
  const [busy, setBusy] = useState<Busy>(null);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<{ message: string; blocked: boolean } | null>(null);
  const [previewVersion, setPreviewVersion] = useState(() => generatedAt(project) ?? 0);
  const [missing, setMissing] = useState(false);
  /** One automatic generation per visit; the buttons do the rest. */
  const [autoRan, setAutoRan] = useState(false);

  const generated = generatedAt(project);
  const superseded = isSuperseded(project);
  const gateOk = summary.blockers.length === 0;
  const canExport = gateOk && busy === null;
  const left = 4 - summary.confirmedCount;
  const isRenewal = summary.kind === "renewal";
  const coverDate = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date());

  /** Generate every format and retain them; returns the requested blob. */
  const generate = useCallback(
    async (wanted: ExportFormat): Promise<Blob> => {
      const payload = buildPresentationRequest(project, insurers);
      const stats = editStats(project);
      const formats: ExportFormat[] = ["pptx", "pdf", ...(payload.credit_limits.length ? ["limits-xlsx" as const] : [])];
      const blobs: Partial<Record<ExportFormat, Blob>> = {};
      for (const format of formats) blobs[format] = (await presentationApi.generate(format, project.id, payload, stats)).blob;
      const next = await update(markGenerated);
      setPreviewVersion(generatedAt(next) ?? Date.now());
      setMissing(false);
      return blobs[wanted]!;
    },
    [project, insurers, update],
  );

  const refreshPreview = useCallback(async () => {
    setError(null);
    setBusy("preview");
    try {
      await generate("pdf");
    } catch (err) {
      const blocked = err instanceof ApiError && err.status === 409;
      setError({ message: errorMessage(err, "Generation failed"), blocked });
    } finally {
      setBusy(null);
    }
  }, [generate]);

  const exportAs = async (format: ExportFormat) => {
    if (!canExport) return;
    setError(null);
    setFlash(false);
    setBusy(format);
    try {
      const blob = await generate(format);
      saveBlob(blob, exportFilename(project, format));
      setFlash(true);
      toast.success("Presentation generated");
    } catch (err) {
      const blocked = err instanceof ApiError && err.status === 409;
      setError({ message: errorMessage(err, "Generation failed"), blocked });
    } finally {
      setBusy(null);
    }
  };

  // First visit with the gate passed and nothing generated yet: build the
  // presentation straight away (BRD 2.8 "preview generations").
  const needsFirstPreview = gateOk && !generated && busy === null && !autoRan;
  useEffect(() => {
    if (!needsFirstPreview) return;
    const t = window.setTimeout(() => {
      setAutoRan(true);
      void refreshPreview();
    }, 0);
    return () => window.clearTimeout(t);
  }, [needsFirstPreview, refreshPreview]);

  // The record says "generated" but no PDF is stored (an older project):
  // regenerate once when the gate allows, else fall back to the mock-up.
  const onMissing = useCallback(() => {
    if (gateOk && !autoRan) {
      setAutoRan(true);
      void refreshPreview();
      return;
    }
    setMissing(true);
  }, [gateOk, autoRan, refreshPreview]);

  const showDeck = Boolean(generated) && !missing;

  return (
    <div className="grid items-start gap-[26px] lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* ── Preview ───────────────────────────────────────────────── */}
      <div className="min-w-0">
        <h1 className="mb-1.5 text-[26px] font-bold tracking-[-0.4px] text-ink">Generate &amp; export</h1>
        <p className="mb-5 text-[13.5px] text-ink-2">Preview of the presentation. Regenerating replaces the previous export under this project.</p>

        {busy === "preview" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[12.5px] text-ink-2" role="status">
              <LoaderCircle className="size-4 animate-spin text-primary" />
              Generating the presentation…
            </div>
            <DeckSkeleton />
          </div>
        ) : showDeck ? (
          <div className="space-y-3">
            {superseded && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-[12.5px] text-warn">
                <span className="font-medium">Edited since this preview was generated.</span>
                <button type="button" onClick={() => void refreshPreview()} disabled={!canExport} className="font-semibold underline-offset-2 hover:underline disabled:opacity-50">
                  Refresh preview →
                </button>
              </div>
            )}
            <DeckPreview projectId={project.id} version={previewVersion} onMissing={onMissing} />
          </div>
        ) : (
          <div className="flex flex-col gap-4" aria-label="Presentation preview (mock-up)">
            {!gateOk && (
              <p className="text-[12.5px] text-ink-3">The generated presentation appears here once the key values are confirmed. Below is the layout it will follow.</p>
            )}
            {/* cover */}
            <div className="flex aspect-video max-w-full flex-col justify-center rounded-[10px] border border-line bg-[linear-gradient(155deg,#0f1424,#252f68)] px-10 py-[34px] text-white shadow-[0_4px_18px_rgba(20,30,50,.08)]">
              <div className="mb-4 font-mono text-xs font-medium tracking-[1.5px] text-[#8fa2c9] uppercase">{isRenewal ? "Renewal" : "New business"}</div>
              <div className="max-w-[80%] text-[clamp(22px,3.4vw,34px)] leading-[1.15] font-semibold tracking-[-0.5px]">{summary.coverTitle}</div>
              <div className="mt-5 text-[15px] text-[#c3cfe0]">
                {summary.clientName || <span className="text-warn">Client name not set</span>} · {coverDate}
              </div>
            </div>
            {/* important information */}
            <div className="rounded-[14px] border border-line bg-white px-7 py-6 shadow-card">
              <div className="mb-2.5 text-base font-semibold text-ink">Important information</div>
              <p className="mb-3.5 text-xs leading-[1.6] text-ink-2">
                Regulatory wording as required by the Financial Conduct Authority. This summary does not amend the policy documents.
              </p>
              <div className="mb-1.5 font-mono text-[10.5px] font-medium tracking-[.5px] text-ink-3 uppercase">Insurers approached</div>
              <div className="mb-2 text-[12.5px] text-ink">
                {summary.included.length ? `${summary.included.join(", ")} — quotations obtained.` : "No quotations obtained yet."}
              </div>
              {summary.declined.length > 0 && (
                <div className="rounded-md bg-warn-soft px-2.5 py-[7px] text-[12.5px] text-warn">
                  {summary.declined.join(", ")} {summary.declined.length === 1 ? "was" : "were"} approached but declined to quote.
                </div>
              )}
            </div>
            {/* terms mini */}
            <div className="overflow-hidden rounded-[14px] border border-line bg-white px-6 py-[22px] shadow-card">
              <div className="mb-3 text-base font-semibold text-ink">Terms comparison</div>
              <MiniGrid project={project} recommendedId={typeof project.recommended === "string" ? project.recommended : null} />
              <div className="mt-2.5 font-mono text-[10.5px] font-medium text-ink-3">
                {summary.buyerCount ? "+ buyer credit limits · " : "+ "}comments &amp; recommendation · contact
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Export panel ──────────────────────────────────────────── */}
      <aside className="rounded-[14px] border border-line bg-surface p-5 shadow-card lg:sticky lg:top-[76px]">
        <div className="mb-1 text-[15px] font-semibold text-ink">Export</div>
        <div className="mb-4 text-[12.5px] text-ink-2">One to two minutes. Nothing is sent from the system.</div>

        <div className="mb-4 flex flex-col gap-2.5">
          <button
            type="button"
            disabled={!canExport}
            aria-disabled={!gateOk}
            onClick={() => exportAs("pptx")}
            className={cn(
              "flex h-11 w-full items-center justify-center gap-2 rounded-[9px] text-sm font-semibold transition-colors",
              gateOk ? "bg-primary text-white shadow-[0_1px_2px_rgba(79,70,229,.4)] hover:bg-accent-foreground disabled:opacity-70" : "cursor-not-allowed bg-[#e7eaef] text-ink-3 opacity-70",
            )}
          >
            {busy === "pptx" ? <LoaderCircle className="size-4 animate-spin" /> : <DownloadIcon />}
            {busy === "pptx" ? "Generating…" : "Download PowerPoint"}
          </button>
          <button
            type="button"
            disabled={!canExport}
            aria-disabled={!gateOk}
            onClick={() => exportAs("pdf")}
            className={cn(
              "flex h-11 w-full items-center justify-center gap-2 rounded-[9px] border bg-surface text-sm font-semibold transition-colors",
              gateOk ? "border-primary text-primary hover:bg-accent disabled:opacity-70" : "cursor-not-allowed border-line text-ink-3 opacity-70",
            )}
          >
            {busy === "pdf" ? <LoaderCircle className="size-4 animate-spin" /> : <DownloadIcon />}
            {busy === "pdf" ? "Generating…" : "Download PDF"}
          </button>
        </div>

        <div
          role="status"
          className={cn(
            "rounded-[9px] border px-[13px] py-[11px] text-xs leading-[1.5]",
            gateOk ? "border-ok bg-ok-soft text-ok" : "border-warn bg-warn-soft text-warn",
          )}
        >
          {gateOk
            ? summary.included.length
              ? "✓ All key values confirmed. Export is enabled."
              : "✓ Limits-only presentation — no quote terms to confirm. Export is enabled."
            : left > 0 && summary.included.length
              ? `⚠ Export is blocked until Est. premium, indemnity, excess and max liability are confirmed on the review screen (${left} remaining).`
              : "⚠ Export is blocked."}
          {summary.blockers
            .filter((b) => !b.startsWith("Confirm the four"))
            .map((b) => (
              <span key={b} className="mt-1 block">
                {b}
              </span>
            ))}
        </div>

        {flash && (
          <div className="mt-3 rounded-lg bg-ok-soft px-3 py-2.5 text-[12.5px] font-medium text-ok">✓ Files generated — ready to proofread &amp; send.</div>
        )}
        {error && (
          <div role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[12.5px] text-destructive">
            <span className="font-medium">{error.blocked ? "Export blocked. " : "Generation failed. "}</span>
            {error.message}
            {error.blocked && (
              <>
                {" "}
                <Link href={routes.projectStep(project.id, "review")} className="font-medium underline">
                  Go to Review
                </Link>
              </>
            )}
          </div>
        )}

        <div className="mt-[18px] flex justify-between border-t border-line-2 pt-3.5 text-xs text-ink-3">
          <span>Type</span>
          <span className="font-medium text-ink">{isRenewal ? "Renewal" : "New business"}</span>
        </div>
        <Link href={routes.projectStep(project.id, "setup")} className="mt-1.5 block text-xs font-medium text-primary hover:no-underline">
          Switch to {isRenewal ? "new business" : "renewal"} in Setup →
        </Link>
        {generated && (
          <p className="mt-3 text-xs text-ink-3">
            Last generated {formatUpdatedFull(generated)}. File: {exportFilename(project, "pptx")}
          </p>
        )}
      </aside>
    </div>
  );
}

/** S8 — Generate & export. Client boundary for the page. */
export function ExportScreen() {
  return <ProjectScreen>{(project) => <ExportBody key={project.id} project={project} />}</ProjectScreen>;
}
