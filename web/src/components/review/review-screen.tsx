"use client";

import { ArrowRight, Check, CloudOff, Expand, LoaderCircle, PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { ProjectScreen } from "@/components/projects/project-screen";
import { ComparisonGrid } from "@/components/review/comparison-grid";
import { ConfirmBar } from "@/components/review/confirm-bar";
import { SourcePageDialog } from "@/components/review/source-page-dialog";
import { SourceViewer, type SourceRef } from "@/components/review/source-viewer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useInsurers } from "@/hooks/use-insurers";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReviewDraft, type SaveState } from "@/hooks/use-review-draft";
import type { ProjectState } from "@/lib/api/types";
import type { FieldDef } from "@/lib/fields";
import { PROJECT_STEPS, routes } from "@/lib/navigation";
import {
  CONFIRM_KEYS,
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

function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, { label: string; className: string; Icon?: typeof Check }> = {
    idle: { label: "", className: "" },
    dirty: { label: "Unsaved edits", className: "text-muted-foreground" },
    saving: { label: "Saving…", className: "text-muted-foreground", Icon: LoaderCircle },
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

const LEGEND = [
  { swatch: "border-set bg-set-soft", label: "Set field (setup / insurer rule)" },
  { swatch: "border-border bg-card", label: "Extracted by AI" },
  { swatch: "border-primary bg-card", label: "Edited by broker", dot: true },
  { swatch: "border-warn bg-warn-soft", label: "Low confidence / confirm before export" },
  { swatch: "border-ok bg-ok-soft", label: "Confirmed" },
  { swatch: "border-dashed border-ink-3 bg-card", label: "Blank (—) vs zero (0 / Nil)" },
  { swatch: "border-border bg-muted", label: "Declined to quote" },
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
  });

  /** A cell was focused: the side panel follows it to the cited page. */
  const selectCell = (col: ProjectColumn, field: FieldDef, page: number | null) => {
    if (col.manual) return;
    setSource(refFor(col, field, page));
  };

  /** The page chip was clicked: open the page, expanded (modal on small screens). */
  const openSource = (col: ProjectColumn, field: FieldDef, page: number) => {
    setSource(refFor(col, field, page));
    if (isMobile) setExpanded(true);
    else setPanelOpen(true);
  };

  const showPanel = panelOpen && !isMobile;

  const proceed = async () => {
    await flush();
    router.push(routes.projectStep(p.id, "limits"));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`Step 3 of ${PROJECT_STEPS.length}`}
        title="Review and edit"
        description="Same shape as the presentation slide, pre-populated. Every cell is editable, extracted or set. Enter moves down a row, Tab moves across."
        actions={<SaveIndicator state={saveState} />}
      />

      <ConfirmBar
        flags={flags}
        disabled={columns.length === 0}
        onToggle={(k) => commit((s) => toggleConfirm(s, k))}
        onConfirmAll={() => commit((s) => CONFIRM_KEYS.reduce((acc, k) => toggleConfirm(acc, k, true), s))}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground" aria-label="Legend">
          {LEGEND.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className={cn("relative size-3 rounded-[3px] border", l.swatch)}>
                {l.dot && <span className="absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />}
              </span>
              {l.label}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          {!isMobile && !panelOpen && (
            <Button variant="outline" size="sm" onClick={() => setPanelOpen(true)}>
              <PanelRightOpen data-icon="inline-start" />
              Show source
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => commit(addManualColumn)}>
            <Plus data-icon="inline-start" />
            Add free-format column
          </Button>
        </div>
      </div>

      {columns.length || (Array.isArray(p.approached) && p.approached.length) ? (
        <div className={cn("flex items-start gap-4", showPanel && "xl:grid xl:grid-cols-[minmax(0,1fr)_380px]")}>
          <div className="min-w-0 flex-1">
            <ComparisonGrid
              project={p}
              insurers={insurers}
              onCell={(colId, field, value) => commit((s) => setCell(s, colId, field, value))}
              onRename={(colId, name) => commit((s) => setColumnName(s, colId, name))}
              onRemove={(colId) => commit((s) => removeColumn(s, colId))}
              onToggleConfirm={(k) => commit((s) => toggleConfirm(s, k))}
              onOpenSource={openSource}
              onSelectCell={selectCell}
            />
          </div>
          {showPanel && (
            <aside
              className="sticky top-16 hidden h-[70vh] min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-card xl:flex"
              aria-label="Source document"
            >
              <div className="flex items-center justify-between border-b px-3 py-1.5">
                <span className="label-mono">Source</span>
                <div className="flex items-center gap-0.5">
                  <Button variant="ghost" size="icon-xs" aria-label="Expand source viewer" disabled={!source} onClick={() => setExpanded(true)}>
                    <Expand />
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label="Hide source panel" onClick={() => setPanelOpen(false)}>
                    <PanelRightClose />
                  </Button>
                </div>
              </div>
              <SourceViewer source={source} className="min-h-0 flex-1" />
            </aside>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          No comparison columns yet. Upload quotes on the previous step, or add a free-format column for terms
          agreed offline.
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {columns.length} comparison column{columns.length === 1 ? "" : "s"}, one per quote, in the order ticked at
        setup. A ticked insurer with no quote shows as declined. A second quote from the same insurer, or terms
        agreed offline, go in a free-format column.
      </p>

      <div className="rounded-xl border bg-card p-4 shadow-card">
        <label htmlFor="review-notes" className="mb-2 block text-sm font-semibold">
          Free-format notes <span className="font-normal text-muted-foreground">(appears beneath the comparison)</span>
        </label>
        <Textarea
          id="review-notes"
          defaultValue={typeof p.notes === "string" ? p.notes : ""}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (p.notes ?? "")) commit((s) => setNotes(s, v));
          }}
          className="min-h-20"
        />
      </div>

      {/* Review gate: ticked by the broker, cleared automatically by any grid change. */}
      <div
        className={cn(
          "flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
          reviewed ? "border-ok/40 bg-ok-soft" : "border-border bg-card",
        )}
      >
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox
            id="reviewed-all"
            checked={reviewed}
            disabled={columns.length === 0}
            onCheckedChange={(on) => commit((s) => setReviewed(s, Boolean(on)))}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">I&apos;ve reviewed all columns</span>
            <span className="block text-xs text-muted-foreground">
              Required to continue. Any change to the grid clears this tick, so re-check after editing.
            </span>
          </span>
        </label>
        <div className="flex items-center gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href={routes.projectStep(p.id, "upload")} />}>
            Back to upload
          </Button>
          <Button onClick={proceed} disabled={!reviewed || columns.length === 0}>
            Continue to credit limits
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>

      <SourcePageDialog source={source} open={expanded} onClose={() => setExpanded(false)} />
    </div>
  );
}

/** S5 — Review and edit. Client boundary for the page. */
export function ReviewScreen() {
  return <ProjectScreen>{(project) => <ReviewBody key={project.id} project={project} />}</ProjectScreen>;
}
