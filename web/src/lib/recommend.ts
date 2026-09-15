/**
 * S7 recommendation (BRD 2.7): the broker picks the recommended insurer
 * (the system never ranks), the insurer's name is merged into the fixed
 * FCA-type wording, the reasons are free text, and the choice highlights
 * that column in the comparison and credit-limit tables.
 */
import type { ProjectState } from "@/lib/api/types";
import { FIELDS, type FieldDef } from "@/lib/fields";
import { renderValue } from "@/lib/money";
import { cellValue, projectColumns } from "@/lib/review";
import type { ProjectColumn } from "@/lib/uploads";

export interface RecommendProjectState extends ProjectState {
  recommended?: string | null;
  reasons?: string;
  /** Optional "key differences" block for the comments slide. */
  keyDifferences?: string;
}

/**
 * The fixed wording on the recommendation slide, exactly as the backend
 * renders it (backend/app/services/presentation.py RECOMMENDATION_WORDING).
 * `{name}` marks where the insurer's business name is merged.
 */
export const RECOMMENDATION_WORDING =
  "The policy we propose to arrange is provided by {name}, which is one of the UK's leading Credit Insurance companies. " +
  "An explanation of the proposed policy is included in the policy documents. We are not contractually obliged to purchase " +
  "insurance products from {name}. Our past experience, and analysis of the market, has shown that the cover provided by " +
  "{name} is comprehensive and its premiums competitive.";

export const REASONS_INTRO = "In addition to this, the following points were important with our recommendation:";

/** Roughly what fits in the reasons box on the slide. */
export const REASONS_GUIDE_CHARS = 600;
export const REASONS_MAX_CHARS = 4000; // backend cap

/** Insurers the broker can recommend: every quote column (not the expiring policy). */
export function recommendableColumns(p: ProjectState): ProjectColumn[] {
  return projectColumns(p).filter((c) => !c.expiring);
}

export function recommendedColumn(p: ProjectState): ProjectColumn | null {
  const id = (p as RecommendProjectState).recommended;
  return id ? (projectColumns(p).find((c) => c.id === id) ?? null) : null;
}

/** Split the wording into text and name segments for highlighting. The
 *  wording comes from the backend's configuration when loaded; the
 *  constant above is the fallback until it arrives. */
export function mergeSegments(name: string | null, wording: string = RECOMMENDATION_WORDING): { text: string; name: boolean }[] {
  const parts = wording.split("{name}");
  const out: { text: string; name: boolean }[] = [];
  parts.forEach((part, i) => {
    if (part) out.push({ text: part, name: false });
    if (i < parts.length - 1) out.push({ text: name ?? "[insurer]", name: true });
  });
  return out;
}

/**
 * How the backend turns the reasons text into slide points: one per
 * non-empty line, any leading "1." / "-" / "•" stripped, then numbered.
 */
export function reasonPoints(reasons: string): string[] {
  return reasons
    .split(/\r?\n/)
    .map((ln) => ln.replace(/^\s*(?:\d+[.)]\s+|[-•]\s+)/, "").trim())
    .filter(Boolean);
}

/** The five headline terms shown in the mini grid. */
export const MINI_FIELD_KEYS = [
  "premium_rate",
  "estimated_annual_premium_exc_ipt",
  "indemnity",
  "excess",
  "max_annual_liability",
] as const;

export function miniFields(): FieldDef[] {
  return MINI_FIELD_KEYS.map((k) => FIELDS.find((f) => f.key === k)!).filter(Boolean);
}

export function miniValue(p: ProjectState, col: ProjectColumn, field: FieldDef): string {
  return renderValue(field.key, cellValue(p, col, field)) || "—";
}

// ── Mutations ───────────────────────────────────────────────────────────

/** Select; selecting the current choice again unselects (BRD 2.7). */
export function setRecommended(p: ProjectState, colId: string | null): RecommendProjectState {
  const current = (p as RecommendProjectState).recommended ?? null;
  const next = colId !== null && colId === current ? null : colId;
  return { ...(p as RecommendProjectState), recommended: next, updated: Date.now() };
}

export function setReasons(p: ProjectState, reasons: string): RecommendProjectState {
  return { ...(p as RecommendProjectState), reasons: reasons.slice(0, REASONS_MAX_CHARS), updated: Date.now() };
}

export function setKeyDifferences(p: ProjectState, text: string): RecommendProjectState {
  return { ...(p as RecommendProjectState), keyDifferences: text.slice(0, REASONS_MAX_CHARS), updated: Date.now() };
}
