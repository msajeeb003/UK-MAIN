"use client";

import { ArrowRight, Check, CloudOff, LoaderCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { LimitsGrid } from "@/components/limits/limits-grid";
import { PageHeader } from "@/components/layout/page-header";
import { ProjectScreen } from "@/components/projects/project-screen";
import { Button } from "@/components/ui/button";
import { useReviewDraft, type SaveState } from "@/hooks/use-review-draft";
import type { ProjectState } from "@/lib/api/types";
import {
  addBuyerRow,
  creditRows,
  hasLimitData,
  limitColumns,
  removeBuyerRow,
  removeLimitColumn,
  setBuyerField,
  setOffer,
} from "@/lib/limits";
import { PROJECT_STEPS, routes } from "@/lib/navigation";
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
  { swatch: "border-border bg-card", label: "Extracted from a document" },
  { swatch: "border-primary bg-card", label: "Edited by broker", dot: true },
  { swatch: "border-dashed border-ink-3 bg-card", label: "Blank (—) vs declined (0)" },
];

function LimitsBody({ project }: { project: ProjectState }) {
  const router = useRouter();
  const { draft, commit, saveState, flush } = useReviewDraft(project);
  const rows = creditRows(draft);
  const columns = limitColumns(draft);
  const included = hasLimitData(draft);
  const focusRow = useRef<string | null>(null);

  // Focus the buyer-name cell of a row just added with "Add buyer".
  useEffect(() => {
    if (!focusRow.current) return;
    const el = document.getElementById(`limit-${focusRow.current}-buyer`) as HTMLInputElement | null;
    el?.focus();
    focusRow.current = null;
  });

  const addBuyer = () => {
    let id: string | null = null;
    commit((s) => {
      const r = addBuyerRow(s);
      id = r.rowId;
      return r.state;
    });
    focusRow.current = id;
  };

  const proceed = async () => {
    await flush();
    router.push(routes.projectStep(draft.id, "recommend"));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`Step 4 of ${PROJECT_STEPS.length}`}
        title="Buyer credit limits"
        description="Limits per buyer from the uploaded schedules and any embedded in quotes. Fully editable: add rows for facilities agreed offline that appear in no document."
        actions={<SaveIndicator state={saveState} />}
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
          <li className="font-mono text-[11px] text-ink-3">All amounts in full pounds (£), thousand separators added on save</li>
        </ul>
        <Button variant="secondary" size="sm" onClick={addBuyer}>
          <Plus data-icon="inline-start" />
          Add buyer
        </Button>
      </div>

      {rows.length ? (
        <LimitsGrid
          project={draft}
          onBuyerField={(rowId, field, value) => commit((s) => setBuyerField(s, rowId, field, value))}
          onOffer={(rowId, colId, value) => commit((s) => setOffer(s, rowId, colId, value))}
          onRemoveRow={(rowId) => commit((s) => removeBuyerRow(s, rowId))}
          onRemoveColumn={(colId) => commit((s) => removeLimitColumn(s, colId))}
        />
      ) : (
        <div className="rounded-xl border border-dashed bg-card px-6 py-12 text-center">
          <p className="text-sm font-medium">No credit limits supplied</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This page will be omitted from the presentation. Upload a credit-limit schedule, or add a buyer for a
            facility agreed offline.
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {included
          ? `${rows.length} buyer${rows.length === 1 ? "" : "s"} across ${columns.length} insurer column${columns.length === 1 ? "" : "s"}. The credit-limit page will be included in the presentation.`
          : "Around 90% of limits arrive as a separate schedule. With no limits, the credit-limit page is omitted cleanly."}
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" nativeButton={false} render={<Link href={routes.projectStep(draft.id, "review")} />}>
          Back to review
        </Button>
        <Button onClick={proceed}>
          Continue to recommendation
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}

/** S6 — Buyer credit limits. Client boundary for the page. */
export function LimitsScreen() {
  return <ProjectScreen>{(project) => <LimitsBody key={project.id} project={project} />}</ProjectScreen>;
}
