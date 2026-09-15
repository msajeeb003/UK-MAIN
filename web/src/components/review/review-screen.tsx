"use client";

import { Check, CloudOff, Expand, LoaderCircle, PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProjectScreen } from "@/components/projects/project-screen";
import { ComparisonGrid } from "@/components/review/comparison-grid";
import { ConfirmBar } from "@/components/review/confirm-bar";
import { SourcePageDialog } from "@/components/review/source-page-dialog";
import { SourceViewer, type SourceRef } from "@/components/review/source-viewer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useInsurers } from "@/hooks/use-insurers";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReviewDraft, type SaveState } from "@/hooks/use-review-draft";
import type { ProjectState } from "@/lib/api/types";
import type { FieldDef } from "@/lib/fields";
import { routes } from "@/lib/navigation";
import { setRecommended } from "@/lib/recommend";
import {
  addManualColumn,
  confirmedFlags,
  isReviewed,
  projectColumns,
  removeColumn,
  setCell,
  setColumnName,
  setNotes,
  setReviewed,
  toggleConfirm,
  type ReviewProjectState,
} from "@/lib/review";
import type { ProjectColumn } from "@/lib/uploads";
import { cn } from "@/lib/utils";

export function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, { label: string; className: string; Icon?: typeof Check }> = {
    idle: { label: "", className: "" },
    dirty: { label: "Unsaved edits", className: "text-ink-3" },
    saving: { label: "Saving…", className: "text-ink-3", Icon: LoaderCircle },
    saved: { label: "Saved", className: "text-ok", Icon: Check },
    error: { label: "Not saved", className: "text-destructive", Icon: CloudOff },
  };
  const m = map[state];
  if (!m.label) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", m.className)} aria-live="polite">
      {m.Icon && <m.Icon className={cn("size-3.5", state === "saving" && "animate-spin")} />}
      {m.label}
    </span>
  );
}

/** The wireframe's three-swatch legend. */
const LEGEND = [
  { swatch: "border-set bg-set-soft", label: "Set field" },
  { swatch: "border-warn bg-warn-soft", label: "Confirm before export" },
  { swatch: "border-primary bg-rec", label: "Recommended" },
];

function ReviewBody({ project }: { project: ProjectState }) {
  const router = useRouter();
  const { insurers } = useInsurers();
  const { draft, commit, saveState, flush } = useReviewDraft(project);
  const p = draft as ReviewProjectState;
  const columns = projectColumns(p);
  const flags = confirmedFlags(p);
  const reviewed = isReviewed(p);
  const isMobile = useIsMobile();
  const [source, setSource] = useState<SourceRef | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const refFor = (col: ProjectColumn, field: FieldDef, page: number | null): SourceRef => ({
    caption: col.name,
    term: field.label,
    docId: col.docId ?? null,
    page,
    pages: col.pages ?? null,
    manual: col.manual,
  });

  /** A cell was focused: the side panel follows it to the cited page. */
  const selectCell = (col: ProjectColumn, field: FieldDef, page: number | null) => {
    setSource(refFor(col, field, page));
  };

  const hasDocuments = columns.some((c) => c.docId);
  const emptyHint = !columns.length
    ? "No quotes uploaded yet. Once a quote is extracted, click any value here to see the page it came from."
    : !hasDocuments
      ? "The columns in this comparison have no retained document (free-format or an older project), so there are no source pages to show."
      : "Select a value in the grid to see the page it came from.";

  /** The page chip was clicked: open the page, expanded (modal on small screens). */
  const openSource = (col: ProjectColumn, field: FieldDef, page: number) => {
    setSource(refFor(col, field, page));
    if (isMobile) setExpanded(true);
    else setPanelOpen(true);
  };

  const showPanel = panelOpen && !isMobile;
  const hasGrid = columns.length > 0 || (Array.isArray(p.approached) && p.approached.length > 0);

  const proceed = async () => {
    await flush();
    router.push(routes.projectStep(p.id, "limits"));
  };

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-1.5 text-[26px] font-bold tracking-[-0.4px] text-ink">Review &amp; edit</h1>
          <p className="text-[13.5px] text-ink-2">Same shape as the presentation slide, pre-populated. Every cell is editable.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[11.5px] text-ink-2">
          <SaveIndicator state={saveState} />
          {LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-[11px] rounded-[3px] border", l.swatch)} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      <ConfirmBar flags={flags} disabled={columns.length === 0} onToggle={(k) => commit((s) => toggleConfirm(s, k))} />

      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12.5px] text-ink-2">
          {columns.length} comparison column{columns.length === 1 ? "" : "s"} — one per quote. Add a free-format column for a second
          quote from the same insurer or terms agreed offline.
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {!isMobile && !panelOpen && (
            <Button variant="outline" size="sm" onClick={() => setPanelOpen(true)}>
              <PanelRightOpen />
              Show source
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => commit(addManualColumn)}>
            <Plus className="size-[15px]" strokeWidth={2.4} />
            Add comparison column
          </Button>
        </div>
      </div>

      {hasGrid ? (
        <div className={cn("flex items-start gap-4", showPanel && "xl:grid xl:grid-cols-[minmax(0,1fr)_380px]")}>
          <div className="min-w-0 flex-1">
            <ComparisonGrid
              project={p}
              insurers={insurers}
              onCell={(colId, field, value) => commit((s) => setCell(s, colId, field, value))}
              onRename={(colId, name) => commit((s) => setColumnName(s, colId, name))}
              onRemove={(colId) => commit((s) => removeColumn(s, colId))}
              onPickRecommended={(colId) => commit((s) => setRecommended(s, colId))}
              onOpenSource={openSource}
              onSelectCell={selectCell}
            />
          </div>
          {showPanel && (
            <aside
              className="sticky top-[76px] hidden h-[70vh] min-h-0 flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-card xl:flex"
              aria-label="Source document"
            >
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                <span className="text-sm font-semibold text-ink">Source document</span>
                <div className="flex items-center gap-0.5">
                  <Button variant="ghost" size="icon-xs" aria-label="Expand source viewer" disabled={!source} onClick={() => setExpanded(true)}>
                    <Expand />
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label="Hide source panel" onClick={() => setPanelOpen(false)}>
                    <PanelRightClose />
                  </Button>
                </div>
              </div>
              <SourceViewer source={source} emptyHint={emptyHint} className="min-h-0 flex-1" />
            </aside>
          )}
        </div>
      ) : (
        <div className="rounded-[14px] border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-ink-2">
          No comparison columns yet. Upload quotes on the previous step, or add a free-format column for terms agreed offline.
        </div>
      )}

      <div className="mt-4 rounded-[14px] border border-line bg-surface px-[18px] py-4 shadow-card">
        <label htmlFor="review-notes" className="mb-2 block text-[12.5px] font-semibold text-ink-2">
          Free-format notes <span className="font-normal text-ink-3">— appears beneath the comparison</span>
        </label>
        <Textarea
          id="review-notes"
          defaultValue={typeof p.notes === "string" ? p.notes : ""}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (p.notes ?? "")) commit((s) => setNotes(s, v));
          }}
          className="min-h-16"
        />
      </div>

      <div className="mt-[22px] flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" nativeButton={false} render={<Link href={routes.projectStep(p.id, "upload")} />}>
          ← Back
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-4">
          {/* Review gate: ticked by the broker, cleared automatically by any grid change. */}
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
            <input
              type="checkbox"
              className="sr-only"
              checked={reviewed}
              disabled={columns.length === 0}
              onChange={(e) => commit((s) => setReviewed(s, e.target.checked))}
            />
            <span
              aria-hidden
              className={cn(
                "grid size-[18px] place-items-center rounded-[5px] border-[1.5px] text-[11px] font-bold text-white",
                reviewed ? "border-ok bg-ok" : "border-[#c5cdd8] bg-white",
              )}
            >
              {reviewed ? "✓" : ""}
            </span>
            I’ve reviewed all columns
          </label>
          <Button onClick={proceed} disabled={!reviewed || columns.length === 0}>
            Credit limits →
          </Button>
        </div>
      </div>

      <SourcePageDialog source={source} open={expanded} onClose={() => setExpanded(false)} />
    </div>
  );
}

/** S5 — Review & edit. Client boundary for the page. */
export function ReviewScreen() {
  return <ProjectScreen>{(project) => <ReviewBody key={project.id} project={project} />}</ProjectScreen>;
}
