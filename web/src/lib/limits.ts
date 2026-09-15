/**
 * S6 buyer credit limits (BRD 2.6): rows = buyers, columns = insurers with
 * a quote. Values arrive from credit-limit uploads and from schedules
 * embedded in quotes (folded in by `applyExtraction`); the broker can fix
 * them, add facilities agreed offline, and remove rows or columns. Pure
 * functions over the project state; persistence is the caller's job.
 */
import type { ProjectState } from "@/lib/api/types";
import { projectColumns } from "@/lib/review";
import { uid, type CreditRow, type ProjectColumn, type UploadProjectState } from "@/lib/uploads";

export type BuyerField = "buyer" | "reg" | "req";

export interface LimitRow extends CreditRow {
  /** Added by the broker (no document behind it). */
  manual?: boolean;
  /** Cells the broker changed after extraction: "buyer" | "reg" | "req" | <colId>. */
  edited?: Record<string, boolean>;
}

export interface LimitsProjectState extends UploadProjectState {
  credit?: LimitRow[];
  /** Insurer columns the broker removed from the credit-limit table. */
  limitsHidden?: string[];
}

/** Largest limit required first (Feedback Round 1, D2); rows with no
 *  limit required keep their order at the bottom. */
export function sortLimitRows(rows: LimitRow[]): LimitRow[] {
  return rows
    .map((row, index) => ({ row, index, amount: parseAmount(row.req ?? "") }))
    .sort((a, b) => {
      if (a.amount === null && b.amount === null) return a.index - b.index;
      if (a.amount === null) return 1;
      if (b.amount === null) return -1;
      return b.amount - a.amount || a.index - b.index;
    })
    .map((x) => x.row);
}

export function creditRows(p: ProjectState): LimitRow[] {
  const s = p as LimitsProjectState;
  return sortLimitRows(Array.isArray(s.credit) ? s.credit : []);
}

/** One column per insurer with a quote (the expiring policy is not a quote). */
export function limitColumns(p: ProjectState): ProjectColumn[] {
  const hidden = new Set((p as LimitsProjectState).limitsHidden ?? []);
  return projectColumns(p).filter((c) => !c.expiring && !hidden.has(c.id));
}

/** True when the credit-limit page will be included in the presentation. */
export function hasLimitData(p: ProjectState): boolean {
  return creditRows(p).some((r) => rowHasContent(r));
}

export function rowHasContent(r: LimitRow): boolean {
  return Boolean(r.buyer?.trim() || r.reg?.trim() || r.req?.trim() || Object.values(r.offers ?? {}).some((v) => v?.trim()));
}

// ── Money ───────────────────────────────────────────────────────────────

const ZERO_WORDS = /^(?:nil|none|declined|zero|0|£\s*0|0\.00|£\s*0\.00)$/i;

/** Parse an amount in full pounds; null when the text is not an amount. */
export function parseAmount(value: string): number | null {
  const v = value.trim();
  if (v === "") return null;
  if (ZERO_WORDS.test(v)) return 0;
  const m = v.match(/^(?:[£$€]|gbp)?\s*([\d,]+(?:\.\d+)?)\s*$/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Full pounds with thousand separators: 250000 -> "£250,000". */
export function formatPounds(n: number): string {
  return `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

/**
 * Normalise what the broker typed on blur: numeric text becomes "£1,234,567"
 * (full pounds), zero/nil stays "0" (a declined limit), anything else is
 * kept verbatim so wording like "Pending" survives.
 */
export function normaliseAmount(value: string): string {
  const n = parseAmount(value);
  if (n === null) return value.trim();
  return n === 0 ? "0" : formatPounds(n);
}

/** A declined limit (BRD 2.5 blank-vs-zero rule applies here too). */
export function isDeclined(value: string): boolean {
  return parseAmount(value) === 0;
}

/** Sum of the parseable amounts; null when none parse. */
export function total(values: string[]): number | null {
  let sum = 0;
  let found = false;
  for (const v of values) {
    const n = parseAmount(v ?? "");
    if (n !== null) {
      sum += n;
      found = true;
    }
  }
  return found ? sum : null;
}

export type LimitProvenance = "extracted" | "edited" | "manual" | "blank";

export function cellProvenance(row: LimitRow, key: string, value: string): LimitProvenance {
  if (!value?.trim()) return "blank";
  if (row.edited?.[key]) return "edited";
  if (row.manual) return "manual";
  return "extracted";
}

// ── Mutations ───────────────────────────────────────────────────────────

function withRows(p: ProjectState, credit: LimitRow[]): LimitsProjectState {
  return { ...(p as LimitsProjectState), credit, updated: Date.now() };
}

export function setBuyerField(p: ProjectState, rowId: string, field: BuyerField, value: string): LimitsProjectState {
  const rows = creditRows(p).map((r) => {
    if (r.id !== rowId) return r;
    const next = field === "req" ? normaliseAmount(value) : value.trim();
    if ((r[field] ?? "") === next) return r;
    return { ...r, [field]: next, edited: r.manual ? r.edited : { ...(r.edited ?? {}), [field]: true } };
  });
  return withRows(p, rows);
}

export function setOffer(p: ProjectState, rowId: string, colId: string, value: string): LimitsProjectState {
  const rows = creditRows(p).map((r) => {
    if (r.id !== rowId) return r;
    const next = normaliseAmount(value);
    if ((r.offers?.[colId] ?? "") === next) return r;
    const offers = { ...(r.offers ?? {}) };
    if (next === "") delete offers[colId];
    else offers[colId] = next;
    return { ...r, offers, edited: r.manual ? r.edited : { ...(r.edited ?? {}), [colId]: true } };
  });
  return withRows(p, rows);
}

/** "Add buyer": an empty row for a facility agreed offline. */
export function addBuyerRow(p: ProjectState): { state: LimitsProjectState; rowId: string } {
  const row: LimitRow = { id: uid(), buyer: "", reg: "", req: "", offers: {}, manual: true };
  return { state: withRows(p, [...creditRows(p), row]), rowId: row.id };
}

export function removeBuyerRow(p: ProjectState, rowId: string): LimitsProjectState {
  return withRows(
    p,
    creditRows(p).filter((r) => r.id !== rowId),
  );
}

/**
 * Remove an insurer column from the credit-limit table: its offers are
 * dropped from every row and the column is hidden here (the comparison
 * column itself is untouched). A later limits upload for that insurer
 * brings it back.
 */
export function removeLimitColumn(p: ProjectState, colId: string): LimitsProjectState {
  const s = p as LimitsProjectState;
  const rows = creditRows(p).map((r) => {
    const offers = { ...(r.offers ?? {}) };
    delete offers[colId];
    const edited = { ...(r.edited ?? {}) };
    delete edited[colId];
    return { ...r, offers, edited: Object.keys(edited).length ? edited : undefined };
  });
  return { ...withRows(s, rows), limitsHidden: [...new Set([...(s.limitsHidden ?? []), colId])] };
}

export function restoreLimitColumn(p: ProjectState, colId: string): LimitsProjectState {
  const s = p as LimitsProjectState;
  return { ...s, limitsHidden: (s.limitsHidden ?? []).filter((id) => id !== colId), updated: Date.now() };
}
