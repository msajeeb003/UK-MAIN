"use client";

import { ArrowRight, Check, CloudOff, List, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type KeyboardEvent } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { ProjectScreen } from "@/components/projects/project-screen";
import { MiniGrid } from "@/components/recommend/mini-grid";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useReviewDraft, type SaveState } from "@/hooks/use-review-draft";
import type { ProjectState } from "@/lib/api/types";
import { PROJECT_STEPS, routes } from "@/lib/navigation";
import {
  REASONS_GUIDE_CHARS,
  REASONS_INTRO,
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
import { FIELDS } from "@/lib/fields";
import { cn } from "@/lib/utils";

const NONE = "__none__";

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

/** Enter after a bullet line continues the list; a bullet on an empty line ends it. */
function continueBullets(e: KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== "Enter" || e.shiftKey) return;
  const ta = e.currentTarget;
  const before = ta.value.slice(0, ta.selectionStart);
  const line = before.slice(before.lastIndexOf("\n") + 1);
  const m = line.match(/^(\s*)(?:[-•]|\d+[.)])\s+(.*)$/);
  if (!m) return;
  e.preventDefault();
  const after = ta.value.slice(ta.selectionEnd);
  if (!m[2].trim()) {
    // Empty bullet: drop it and leave the list.
    const start = before.length - line.length;
    ta.setRangeText("", start, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const insert = `\n${m[1]}- `;
  ta.setRangeText(insert, ta.selectionStart, ta.selectionEnd, "end");
  void after;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
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
  const points = reasonPoints(reasons);
  const over = reasons.length > REASONS_GUIDE_CHARS;

  const premiumField = FIELDS.find((f) => f.key === "estimated_annual_premium_exc_ipt")!;
  const indemnityField = FIELDS.find((f) => f.key === "indemnity")!;

  const proceed = async () => {
    await flush();
    router.push(routes.projectStep(p.id, "export"));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`Step 5 of ${PROJECT_STEPS.length}`}
        title="Comments and recommendation"
        description="Standard wording is fixed. You choose the insurer; the system never ranks or suggests. The choice highlights that column in the comparison and credit-limit tables."
        actions={<SaveIndicator state={saveState} />}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.15fr]">
        {/* ── Insurer selector ─────────────────────────────────────── */}
        <section className="rounded-xl border bg-card p-4 shadow-card" aria-labelledby="rec-selector">
          <h2 id="rec-selector" className="text-sm font-semibold">
            Recommended insurer
          </h2>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
            Insurers with a quote. Declined insurers are not listed. Pick one, or continue without a recommendation.
          </p>
          {columns.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No comparison columns yet. Upload quotes first.
            </p>
          ) : (
            <RadioGroup
              value={recommendedId ?? NONE}
              onValueChange={(v) => commit((s) => setRecommended(s, v === NONE || v === null ? null : String(v)))}
              aria-label="Recommended insurer"
              className="gap-2"
            >
              {columns.map((col) => (
                <FieldLabel key={col.id} htmlFor={`rec-${col.id}`}>
                  <Field orientation="horizontal" className={cn(col.id === recommendedId && "border-primary/40 bg-accent")}>
                    <RadioGroupItem value={col.id} id={`rec-${col.id}`} aria-label={col.name} />
                    <FieldContent>
                      <FieldTitle>
                        {col.name}
                        {col.manual && <span className="label-mono ml-2 rounded bg-warn-soft px-1.5 text-[9px] text-warn">Free format</span>}
                      </FieldTitle>
                      <FieldDescription className="text-xs">
                        Est. premium {cellValue(p, col, premiumField) || "—"} · {cellValue(p, col, indemnityField) || "—"} indemnity
                      </FieldDescription>
                    </FieldContent>
                    {col.id === recommendedId && <span className="label-mono rounded border border-primary bg-card px-1.5 text-primary">Recommended</span>}
                  </Field>
                </FieldLabel>
              ))}
              <FieldLabel htmlFor="rec-none">
                <Field orientation="horizontal" className={cn(!recommendedId && "border-primary/40 bg-accent")}>
                  <RadioGroupItem value={NONE} id="rec-none" aria-label="No recommendation" />
                  <FieldContent>
                    <FieldTitle>No recommendation</FieldTitle>
                    <FieldDescription className="text-xs">
                      The presentation keeps the fixed FCA wording but omits the recommendation paragraph and reasons.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            </RadioGroup>
          )}
        </section>

        {/* ── Name-merge preview ───────────────────────────────────── */}
        <section className="rounded-xl border bg-card p-4 shadow-card" aria-labelledby="rec-preview">
          <div className="label-mono mb-2" id="rec-preview">
            Standard wording · fixed · as it will appear on the recommendation slide
          </div>
          {rec ? (
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              {mergeSegments(rec.name).map((seg, i) =>
                seg.name ? (
                  <mark key={i} className="rounded bg-accent px-1 font-semibold text-primary">
                    {seg.text}
                  </mark>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </p>
          ) : (
            <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
              Select an insurer to preview the merged wording. Without a recommendation this paragraph is left out of
              the presentation; the regulatory wording stays.
            </p>
          )}
          {rec && points.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <p className="text-[13px] font-semibold text-ink-2">{REASONS_INTRO}</p>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[13px] text-ink-2">
                {points.map((pt, i) => (
                  <li key={i}>{pt}</li>
                ))}
              </ol>
            </div>
          )}
        </section>
      </div>

      {/* ── Reasons ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="reasons" className="text-sm font-semibold">
            Reasons for the recommendation <span className="font-normal text-muted-foreground">(free text)</span>
          </label>
          <span className={cn("font-mono text-[11px]", over ? "text-warn" : "text-ink-3")} aria-live="polite">
            {reasons.length} / ~{REASONS_GUIDE_CHARS} characters{over ? " · may not fit the slide" : ""}
          </span>
        </div>
        <p className="mt-0.5 mb-2 text-xs text-muted-foreground">
          One point per line. Lines starting with &quot;-&quot; or a number become numbered points on the slide; Enter
          continues a bullet list.
        </p>
        <Textarea
          id="reasons"
          value={reasons}
          maxLength={REASONS_MAX_CHARS}
          onChange={(e) => setReasonsText(e.target.value)}
          onKeyDown={continueBullets}
          onBlur={() => {
            if (reasons !== (p.reasons ?? "")) commit((s) => setReasons(s, reasons));
          }}
          placeholder={"- Highest indemnity at a competitive rate\n- Debt collection included\n- Widest discretionary limit for the client's buyer profile"}
          className="min-h-28 font-[inherit]"
          aria-describedby="reasons-hint"
        />
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              const next = reasons.trim() ? `${reasons.replace(/\s+$/, "")}\n- ` : "- ";
              setReasonsText(next);
              document.getElementById("reasons")?.focus();
            }}
          >
            <List data-icon="inline-start" />
            Add bullet
          </Button>
          <span id="reasons-hint" className="text-xs text-muted-foreground">
            {points.length ? `${points.length} point${points.length === 1 ? "" : "s"} will appear on the slide.` : "Optional."}
          </span>
        </div>
      </section>

      {/* ── Key differences (optional) ──────────────────────────────── */}
      <section className="rounded-xl border bg-card p-4 shadow-card">
        <label htmlFor="key-differences" className="text-sm font-semibold">
          Key differences <span className="font-normal text-muted-foreground">(optional, for the comments)</span>
        </label>
        <p className="mt-0.5 mb-2 text-xs text-muted-foreground">
          Where the quotes materially differ (cover, exclusions, service). Included with the recommendation points.
        </p>
        <Textarea
          id="key-differences"
          value={differences}
          maxLength={REASONS_MAX_CHARS}
          onChange={(e) => setDifferencesText(e.target.value)}
          onKeyDown={continueBullets}
          onBlur={() => {
            if (differences !== (p.keyDifferences ?? "")) commit((s) => setKeyDifferences(s, differences));
          }}
          className="min-h-20"
        />
      </section>

      {/* ── Mini grid preview ───────────────────────────────────────── */}
      <section className="space-y-2" aria-label="Comparison preview">
        <p className="text-xs text-muted-foreground">
          What the client will see: the recommended column is filled on the terms and credit-limit tables.
        </p>
        <MiniGrid project={p} recommendedId={recommendedId} />
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" nativeButton={false} render={<Link href={routes.projectStep(p.id, "limits")} />}>
          Back to credit limits
        </Button>
        <div className="flex items-center gap-3">
          {!rec && columns.length > 0 && <span className="text-xs text-muted-foreground">Continuing without a recommendation.</span>}
          <Button onClick={proceed}>
            Continue to generate
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** S7 — Comments and recommendation. Client boundary for the page. */
export function RecommendScreen() {
  return <ProjectScreen>{(project) => <RecommendBody key={project.id} project={project} />}</ProjectScreen>;
}
