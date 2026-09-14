/**
 * S5 review-grid domain (BRD 2.5): cell values and provenance, the
 * blank-vs-zero rule, edits that keep the AI baseline, column order and
 * declined placeholders, the "reviewed" gate and the confirm-before-export
 * flags. Pure functions over the project state.
 */
import type { Insurer, ProjectState } from "@/lib/api/types";
import { CONFIRM_FIELD_MAP, FIELDS, type ConfirmKey, type FieldDef } from "@/lib/fields";
import { POLICY_TYPES } from "@/lib/project-schema";
import { uid, type CellValue, type ProjectColumn, type UploadProjectState } from "@/lib/uploads";

export const CONFIRM_KEYS: readonly ConfirmKey[] = ["premium", "indemnity", "excess", "maxLiability"];

export const CONFIRM_LABELS: Record<ConfirmKey, string> = {
  premium: "Annual premium",
  indemnity: "Indemnity",
  excess: "Excess",
  maxLiability: "Max liability",
};

export const DEBT_OPTIONS = ["Included", "Outsourced"] as const;

export interface ReviewProjectState extends UploadProjectState {
  notes?: string;
  manualSeq?: number;
  /** "I've reviewed all columns" gate; cleared by any change to the grid. */
  reviewed?: boolean;
  reviewedAt?: number;
}

export function projectColumns(p: ProjectState): ProjectColumn[] {
  return Array.isArray((p as UploadProjectState).columns) ? ((p as UploadProjectState).columns as ProjectColumn[]) : [];
}

// ── Confirm-before-export flags (BRD 2.5) ───────────────────────────────

export function confirmedFlags(p: ProjectState): Record<ConfirmKey, boolean> {
  const c = (p.confirmed ?? {}) as Record<string, boolean>;
  return {
    premium: Boolean(c.premium),
    indemnity: Boolean(c.indemnity),
    excess: Boolean(c.excess),
    maxLiability: Boolean(c.maxLiability),
  };
}

export function confirmedCount(p: ProjectState): number {
  const f = confirmedFlags(p);
  return CONFIRM_KEYS.filter((k) => f[k]).length;
}

export function allConfirmed(p: ProjectState): boolean {
  return confirmedCount(p) === CONFIRM_KEYS.length;
}

/** Backend field names of the confirmed keys (export payload, BRD 2.5). */
export function confirmedFieldNames(p: ProjectState): string[] {
  const f = confirmedFlags(p);
  return CONFIRM_KEYS.filter((k) => f[k]).map((k) => CONFIRM_FIELD_MAP[k]);
}

// ── "Reviewed all columns" gate ─────────────────────────────────────────

export function isReviewed(p: ProjectState): boolean {
  return Boolean((p as ReviewProjectState).reviewed);
}

export function setReviewed(p: ProjectState, on: boolean): ReviewProjectState {
  return { ...(p as ReviewProjectState), reviewed: on, reviewedAt: on ? Date.now() : undefined, updated: Date.now() };
}

/** Any change to the grid invalidates the broker's review tick. */
function unreview(p: ReviewProjectState): ReviewProjectState {
  return p.reviewed ? { ...p, reviewed: false, reviewedAt: undefined } : p;
}

// ── Cell values ─────────────────────────────────────────────────────────

/** Effective text in a cell. Set fields fall back to the project/rule value. */
export function cellValue(p: ProjectState, col: ProjectColumn, field: FieldDef): string {
  if (field.key === "type") {
    const own = col.data?.type;
    return own && own.value !== undefined && own.value !== "" ? own.value : typeof p.policyType === "string" ? p.policyType : "";
  }
  if (field.key === "debt") {
    const own = col.data?.debt;
    return own && own.value !== undefined ? own.value : col.debt || "";
  }
  const sv = col.data?.[field.key];
  return sv ? (sv.value ?? "") : "";
}

/** Policy type set on this column, as opposed to inherited from setup. */
export function hasTypeOverride(col: ProjectColumn): boolean {
  const own = col.data?.type;
  return Boolean(own && own.value);
}

export function cellPage(col: ProjectColumn, field: FieldDef): number | null {
  const sv = col.data?.[field.key];
  return sv && sv.page ? sv.page : null;
}

export function cellUncertain(col: ProjectColumn, field: FieldDef): boolean {
  const sv = col.data?.[field.key];
  return Boolean(sv && sv.conf === "uncertain" && sv.value);
}

/** The text the AI read, for the low-confidence tooltip. */
export function cellRaw(col: ProjectColumn, field: FieldDef): string {
  const sv = col.data?.[field.key];
  return sv?.orig ?? sv?.value ?? "";
}

/** Broker changed the AI's value (BRD §5 edit rate). Set fields never count. */
export function cellEdited(col: ProjectColumn, field: FieldDef): boolean {
  if (field.set) return false;
  const sv = col.data?.[field.key];
  return Boolean(sv && "orig" in sv && (sv.orig ?? "") !== (sv.value ?? ""));
}

export type CellProvenance = "set" | "extracted" | "edited" | "manual" | "blank";

/**
 * Where a cell's content came from. "blank" is the BRD 2.2 case: nothing
 * was found, and nothing is guessed. "manual" is a value typed by the
 * broker with no AI baseline (free-format column, waiting period).
 */
export function cellProvenance(p: ProjectState, col: ProjectColumn, field: FieldDef): CellProvenance {
  if (field.set) return "set";
  const value = cellValue(p, col, field);
  if (value === "") return "blank";
  if (cellEdited(col, field)) return "edited";
  const sv = col.data?.[field.key];
  if (col.manual || field.manual || !sv || !("orig" in sv) || (sv.orig ?? "") === "") return "manual";
  return "extracted";
}

const ZERO_RE = /^[£$€]?\s*0+(?:[.,]0+)?\s*(?:%|p|pence|pct)?$/i;
const ZERO_WORDS = /^(?:nil|none|zero|£?0\.00)$/i;

/** A genuine zero (or nil) as opposed to a blank cell (BRD 2.5 "Blanks"). */
export function isZeroValue(value: string): boolean {
  const v = value.trim();
  return v !== "" && (ZERO_RE.test(v) || ZERO_WORDS.test(v));
}

// ── Column order and declined placeholders ──────────────────────────────

export type DisplayColumn =
  | { kind: "column"; col: ProjectColumn; insurerId: string | null }
  | { kind: "declined"; insurerId: string; name: string };

function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

function insurerIdFor(col: ProjectColumn, insurers: Insurer[]): string | null {
  const byMatched = col.matched ? insurers.find((i) => lower(i.name) === lower(col.matched)) : undefined;
  if (byMatched) return byMatched.id;
  const byName = insurers.find((i) => lower(i.name) === lower(col.name) || lower(col.name).includes(lower(i.name)));
  return byName ? byName.id : null;
}

/**
 * Grid columns in display order: the expiring policy first (renewals),
 * then the insurers in the order they were ticked at setup, a greyed
 * "Declined" placeholder standing in for a ticked insurer with no quote
 * (BRD 2.1), then quotes from insurers that were not ticked, then
 * free-format columns.
 */
export function displayColumns(p: ProjectState, insurers: Insurer[]): DisplayColumn[] {
  const columns = projectColumns(p);
  const approached: string[] = Array.isArray(p.approached) ? (p.approached as string[]) : [];
  const withIds = columns.map((col) => ({ col, insurerId: col.manual || col.expiring ? null : insurerIdFor(col, insurers) }));
  const out: DisplayColumn[] = [];
  const used = new Set<string>();

  for (const { col } of withIds.filter((c) => c.col.expiring)) {
    out.push({ kind: "column", col, insurerId: null });
    used.add(col.id);
  }
  for (const id of approached) {
    const hit = withIds.find((c) => c.insurerId === id && !used.has(c.col.id));
    if (hit) {
      out.push({ kind: "column", col: hit.col, insurerId: id });
      used.add(hit.col.id);
    } else {
      const ins = insurers.find((i) => i.id === id);
      out.push({ kind: "declined", insurerId: id, name: ins?.name ?? id });
    }
  }
  for (const { col, insurerId } of withIds) {
    if (used.has(col.id) || col.manual) continue;
    out.push({ kind: "column", col, insurerId });
    used.add(col.id);
  }
  for (const { col } of withIds) {
    if (used.has(col.id)) continue;
    out.push({ kind: "column", col, insurerId: null });
    used.add(col.id);
  }
  return out;
}

// ── Mutations (all return a new state) ──────────────────────────────────

function withColumns(p: ProjectState, columns: ProjectColumn[]): ReviewProjectState {
  return unreview({ ...(p as ReviewProjectState), columns, updated: Date.now() });
}

/**
 * Write a cell. The AI's original value stays in `orig` so the edit rate
 * can be measured; the source page is dropped when the text no longer
 * matches it; touching the cell counts as human verification, clearing the
 * uncertain flag. Editing a key value invalidates its confirmation, and any
 * edit clears the "reviewed all columns" tick.
 */
export function setCell(p: ProjectState, colId: string, field: FieldDef, value: string): ReviewProjectState {
  const before = projectColumns(p).find((c) => c.id === colId);
  if (!before) return p as ReviewProjectState;
  const prevValue = cellValue(p, before, field);
  if (prevValue === value) return p as ReviewProjectState;

  const columns = projectColumns(p).map((col) => {
    if (col.id !== colId) return col;
    const prev = col.data?.[field.key];
    const next: CellValue = { value, page: null, conf: "high" };
    if (prev && "orig" in prev) next.orig = prev.orig;
    else if (!field.set && !field.manual && !col.manual) next.orig = prev?.value ?? "";
    return { ...col, data: { ...(col.data ?? {}), [field.key]: next } };
  });
  let next = withColumns(p, columns);
  if (field.confirm) next = { ...next, confirmed: { ...(p.confirmed ?? {}), [field.confirm]: false } };
  return next;
}

export function setColumnName(p: ProjectState, colId: string, name: string): ReviewProjectState {
  return withColumns(
    p,
    projectColumns(p).map((c) => (c.id === colId ? { ...c, name } : c)),
  );
}

export function addManualColumn(p: ProjectState): ReviewProjectState {
  const seq = typeof (p as ReviewProjectState).manualSeq === "number" ? (p as ReviewProjectState).manualSeq! : 1;
  const col: ProjectColumn = { id: `m${seq}-${uid().slice(0, 4)}`, name: "Free-format column", manual: true, expiring: false, data: {}, debt: "" };
  return { ...withColumns(p, [...projectColumns(p), col]), manualSeq: seq + 1 };
}

/**
 * Remove a column, its credit-limit offers, and the upload card that
 * produced it (so the file list and the declined-insurers logic stay
 * truthful; the file can be re-uploaded cleanly later).
 */
export function removeColumn(p: ProjectState, colId: string): ReviewProjectState {
  const s = p as ReviewProjectState;
  const credit = (s.credit ?? []).map((r) => {
    const rest = { ...r.offers };
    delete rest[colId];
    return { ...r, offers: rest };
  });
  return unreview({
    ...s,
    columns: projectColumns(p).filter((c) => c.id !== colId),
    credit,
    files: (s.files ?? []).filter((f) => f.colId !== colId),
    recommended: s.recommended === colId ? null : s.recommended,
    updated: Date.now(),
  });
}

export function toggleConfirm(p: ProjectState, key: ConfirmKey, on?: boolean): ReviewProjectState {
  const current = confirmedFlags(p);
  return {
    ...(p as ReviewProjectState),
    confirmed: { ...(p.confirmed ?? {}), [key]: on ?? !current[key] },
    updated: Date.now(),
  };
}

export function setNotes(p: ProjectState, notes: string): ReviewProjectState {
  return { ...(p as ReviewProjectState), notes, updated: Date.now() };
}

/** Column-level policy type must be one of the four, else the project's. */
export function policyTypeOptions(): readonly string[] {
  return POLICY_TYPES;
}

export const REVIEW_FIELDS = FIELDS;
