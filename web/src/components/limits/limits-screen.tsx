"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { LimitsGrid } from "@/components/limits/limits-grid";
import { ProjectScreen } from "@/components/projects/project-screen";
import { SaveIndicator } from "@/components/review/review-screen";
import { Button } from "@/components/ui/button";
import { useReviewDraft } from "@/hooks/use-review-draft";
import type { ProjectState } from "@/lib/api/types";
import { addBuyerRow, creditRows, removeBuyerRow, removeLimitColumn, setBuyerField, setOffer } from "@/lib/limits";
import { routes } from "@/lib/navigation";

function LimitsBody({ project }: { project: ProjectState }) {
  const router = useRouter();
  const { draft, commit, saveState, flush } = useReviewDraft(project);
  const rows = creditRows(draft);
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
    <div>
      <div className="mb-[18px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-1.5 text-[26px] font-bold tracking-[-0.4px] text-ink">Buyer credit limits</h1>
          <p className="text-[13.5px] text-ink-2">Fully editable — add rows for facilities agreed offline that appear in no document.</p>
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator state={saveState} />
          <Button variant="secondary" size="sm" onClick={addBuyer}>
            <Plus className="size-[15px]" strokeWidth={2.4} />
            Add buyer
          </Button>
        </div>
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
        <div className="rounded-[14px] border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">No credit limits supplied</p>
          <p className="mt-1 text-sm text-ink-2">
            Upload a credit-limit schedule on the previous step, or add a buyer for a facility agreed offline.
          </p>
        </div>
      )}

      <p className="mx-0.5 mt-3.5 text-[12.5px] text-ink-2">
        Around 90% of limits arrive as a separate schedule. This page is omitted cleanly from the presentation when no limits are
        supplied.
      </p>

      <div className="mt-[22px] flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" nativeButton={false} render={<Link href={routes.projectStep(draft.id, "review")} />}>
          ← Back
        </Button>
        <Button onClick={proceed}>Recommendation →</Button>
      </div>
    </div>
  );
}

/** S6 — Buyer credit limits. Client boundary for the page. */
export function LimitsScreen() {
  return <ProjectScreen>{(project) => <LimitsBody key={project.id} project={project} />}</ProjectScreen>;
}
