"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type KeyboardEvent } from "react";

import { ProjectScreen } from "@/components/projects/project-screen";
import { SaveIndicator } from "@/components/review/review-screen";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useReviewDraft } from "@/hooks/use-review-draft";
import { presentationApi } from "@/lib/api";
import type { ProjectState } from "@/lib/api/types";
import { FIELDS } from "@/lib/fields";
import { formatMoney } from "@/lib/money";
import { routes } from "@/lib/navigation";
import {
  REASONS_GUIDE_CHARS,
  REASONS_MAX_CHARS,
  mergeSegments,
  reasonPoints,
  recommendableColumns,
  recommendedColumn,
  setKeyDifferences,
  setReasons,
  setRecommended,
  type RecommendProjectState,
} from "@/lib/recommend";
import { cellValue } from "@/lib/review";
import { cn } from "@/lib/utils";

/** Enter after a bullet line continues the list; a bullet on an empty line ends it. */
function continueBullets(e: KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== "Enter" || e.shiftKey) return;
  const ta = e.currentTarget;
  const before = ta.value.slice(0, ta.selectionStart);
  const line = before.slice(before.lastIndexOf("\n") + 1);
  const m = line.match(/^(\s*)(?:[-•]|\d+[.)])\s+(.*)$/);
  if (!m) return;
  e.preventDefault();
  if (!m[2].trim()) {
    // Empty bullet: drop it and leave the list.
    const start = before.length - line.length;
    ta.setRangeText("", start, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  ta.setRangeText(`\n${m[1]}- `, ta.selectionStart, ta.selectionEnd, "end");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2", on ? "border-primary bg-primary" : "border-[#c5cdd8] bg-white")}
    >
      <span className={cn("size-2 rounded-full", on ? "bg-white" : "bg-transparent")} />
    </span>
  );
}

function RecommendBody({ project }: { project: ProjectState }) {
  const router = useRouter();
  const { draft, commit, saveState, flush } = useReviewDraft(project);
  const p = draft as RecommendProjectState;
  const columns = recommendableColumns(p);
  const rec = recommendedColumn(p);
  const recommendedId = rec?.id ?? null;
  const [reasons, setReasonsText] = useState(typeof p.reasons === "string" ? p.reasons : "");
  const [differences, setDifferencesText] = useState(typeof p.keyDifferences === "string" ? p.keyDifferences : "");
  // The fixed wording is configuration on the server; preview exactly what the deck prints.
  const [wording, setWording] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    presentationApi.wording().then(
      (w) => {
        if (!cancelled && typeof w.recommendation === "string") setWording(w.recommendation);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const points = reasonPoints(reasons);
  const over = reasons.length > REASONS_GUIDE_CHARS;

  const premiumField = FIELDS.find((f) => f.key === "estimated_annual_premium_exc_ipt")!;
  const indemnityField = FIELDS.find((f) => f.key === "indemnity")!;

  const pick = (id: string | null) => commit((s) => setRecommended(s, id));

  const proceed = async () => {
    await flush();
    router.push(routes.projectStep(p.id, "export"));
  };

  return (
    <div className="max-w-[900px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-1.5 text-[26px] font-bold tracking-[-0.4px] text-ink">Comments &amp; recommendation</h1>
          <p className="text-[13.5px] text-ink-2">Standard wording is fixed. You choose the insurer — the system never ranks or suggests.</p>
        </div>
        <SaveIndicator state={saveState} />
      </div>

      {/* ── Insurer cards ─────────────────────────────────────────── */}
      {columns.length === 0 ? (
        <p className="mb-4 rounded-[11px] border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-ink-2">
          No comparison columns yet. Upload quotes first.
        </p>
      ) : (
        <div role="radiogroup" aria-label="Recommended insurer" className="mb-4 grid gap-4 sm:grid-cols-2">
          {columns.map((col) => {
            const on = col.id === recommendedId;
            return (
              <button
                key={col.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pick(col.id)}
                className={cn(
                  "flex items-center gap-3 rounded-[11px] border-[1.5px] p-4 text-left transition-colors",
                  on ? "border-primary bg-accent" : "border-line bg-surface hover:border-ink-3",
                )}
              >
                <Radio on={on} />
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-semibold text-ink">
                    {col.name}
                    {col.manual && <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 align-middle font-mono text-[9px] font-medium text-warn uppercase">Free format</span>}
                  </span>
                  <span className="block text-xs text-ink-2">
                    Est. premium {formatMoney(cellValue(p, col, premiumField)) || "—"} · {cellValue(p, col, indemnityField) || "—"} indemnity
                  </span>
                </span>
                {on && (
                  <span className="ml-auto shrink-0 rounded-[5px] border border-primary bg-white px-2 py-[3px] font-mono text-[10px] font-medium text-primary">
                    RECOMMENDED
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={!recommendedId}
            onClick={() => pick(null)}
            className={cn(
              "flex items-center gap-3 rounded-[11px] border-[1.5px] p-4 text-left transition-colors",
              !recommendedId ? "border-primary bg-accent" : "border-line bg-surface hover:border-ink-3",
            )}
          >
            <Radio on={!recommendedId} />
            <span>
              <span className="block text-[14.5px] font-semibold text-ink">No recommendation</span>
              <span className="block text-xs text-ink-2">Keeps the fixed wording; omits the recommendation paragraph and reasons.</span>
            </span>
          </button>
        </div>
      )}

      {/* ── Standard wording ──────────────────────────────────────── */}
      <div className="mb-4 rounded-[14px] border border-line bg-surface px-[22px] py-5 shadow-card">
        <div className="label-mono mb-2.5 font-medium">Standard wording — fixed</div>
        <p className="text-[13.5px] leading-[1.65] text-ink-2">
          {mergeSegments(rec?.name ?? null, wording).map((seg, i) =>
            seg.name ? (
              <strong key={i} className="rounded-[5px] bg-accent px-1.5 py-px font-semibold text-primary">
                {seg.text}
              </strong>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </p>
      </div>

      {/* ── Reasons ───────────────────────────────────────────────── */}
      <div className="rounded-[14px] border border-line bg-surface px-[18px] py-4 shadow-card">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="reasons" className="text-[12.5px] font-semibold text-ink-2">
            Reasons for the recommendation <span className="font-normal text-ink-3">— free text</span>
          </label>
          <span className={cn("font-mono text-[11px]", over ? "text-warn" : "text-ink-3")} aria-live="polite">
            {reasons.length} / ~{REASONS_GUIDE_CHARS}
            {over ? " · may not fit the slide" : ""}
          </span>
        </div>
        <Textarea
          id="reasons"
          value={reasons}
          maxLength={REASONS_MAX_CHARS}
          onChange={(e) => setReasonsText(e.target.value)}
          onKeyDown={continueBullets}
          onBlur={() => {
            if (reasons !== (p.reasons ?? "")) commit((s) => setReasons(s, reasons));
          }}
          placeholder="e.g. Highest indemnity at a competitive rate, debt collection included, and the widest discretionary limit for the client’s buyer profile."
          className="min-h-[90px] leading-[1.55]"
          aria-describedby="reasons-hint"
        />
        <p id="reasons-hint" className="mt-2 text-xs text-ink-3">
          One point per line; lines starting with “-” or a number become numbered points on the slide.
          {points.length ? ` ${points.length} point${points.length === 1 ? "" : "s"} so far.` : ""}
        </p>
      </div>

      {/* ── Key differences (optional) ────────────────────────────── */}
      <div className="mt-4 rounded-[14px] border border-line bg-surface px-[18px] py-4 shadow-card">
        <label htmlFor="key-differences" className="mb-2 block text-[12.5px] font-semibold text-ink-2">
          Key differences <span className="font-normal text-ink-3">— optional, included with the recommendation points</span>
        </label>
        <Textarea
          id="key-differences"
          value={differences}
          maxLength={REASONS_MAX_CHARS}
          onChange={(e) => setDifferencesText(e.target.value)}
          onKeyDown={continueBullets}
          onBlur={() => {
            if (differences !== (p.keyDifferences ?? "")) commit((s) => setKeyDifferences(s, differences));
          }}
          placeholder="Where the quotes materially differ (cover, exclusions, service)."
          className="min-h-16 leading-[1.55]"
        />
      </div>

      <div className="mt-[22px] flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" nativeButton={false} render={<Link href={routes.projectStep(p.id, "limits")} />}>
          ← Back
        </Button>
        <Button onClick={proceed}>Generate &amp; export →</Button>
      </div>
    </div>
  );
}

/** S7 — Comments & recommendation. Client boundary for the page. */
export function RecommendScreen() {
  return <ProjectScreen>{(project) => <RecommendBody key={project.id} project={project} />}</ProjectScreen>;
}
