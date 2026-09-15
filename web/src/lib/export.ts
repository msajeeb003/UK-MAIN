/**
 * S8 generate & export (BRD 2.8): builds the presentation request from the
 * reviewed project state, tracks generation status, and names downloads.
 * Pure functions over ProjectState; the API calls live in the screen.
 */
import type { ExportFormat, Insurer, PresentationRequest, ProjectState } from "@/lib/api/types";
import { FIELDS } from "@/lib/fields";
import { creditRows, hasLimitData, rowHasContent } from "@/lib/limits";
import { reasonPoints, recommendedColumn, type RecommendProjectState } from "@/lib/recommend";
import { cellEdited, cellValue, confirmedFieldNames, displayColumns, projectColumns } from "@/lib/review";
import type { ProjectColumn } from "@/lib/uploads";

export interface ExportProjectState extends RecommendProjectState {
  exported?: boolean;
  /** Epoch ms of the last successful generation. */
  generatedAt?: number;
  notes?: string;
}

export type ProjectKind = "new" | "renewal";

export function projectKind(p: ProjectState): ProjectKind {
  return p.projectType === "renewal" ? "renewal" : "new";
}

/** Front-page title of the deck (backend cover_title). */
export function coverTitle(p: ProjectState): string {
  return projectKind(p) === "renewal" ? "Renewal Credit Insurance Presentation" : "Credit Insurance Presentation";
}

/** "{Renewal|Credit Insurance} Presentation of Terms - {Client}.{ext}" (mirrors the backend). */
export function exportFilename(p: ProjectState, format: ExportFormat): string {
  const client = (p.clientName ?? "").replace(/[^A-Za-z0-9 \-]/g, "").trim() || "Client";
  const kind = projectKind(p) === "renewal" ? "Renewal" : "Credit Insurance";
  const ext = format === "limits-xlsx" ? "xlsx" : format;
  return `${kind} Presentation of Terms - ${client.slice(0, 80)}.${ext}`;
}

export const EXPORT_FORMATS: readonly { format: ExportFormat; label: string }[] = [
  { format: "pptx", label: "PowerPoint" },
  { format: "pdf", label: "PDF" },
  { format: "limits-xlsx", label: "Credit limits (Excel)" },
];

// ── Summary ─────────────────────────────────────────────────────────────

export interface ExportSummary {
  clientName: string;
  reference: string;
  kind: ProjectKind;
  coverTitle: string;
  /** Insurers with a quote, in presentation order. */
  included: string[];
  /** Ticked at setup but no quote uploaded. */
  declined: string[];
  hasExpiring: boolean;
  recommended: string | null;
  buyerCount: number;
  confirmedCount: number;
  /** Reasons a generation would be refused, in the user's words. */
  blockers: string[];
}

export function exportSummary(p: ProjectState, insurers: Insurer[]): ExportSummary {
  const columns = projectColumns(p);
  const included = columns.filter((c) => !c.expiring).map((c) => c.name);
  const declined = displayColumns(p, insurers)
    .filter((d): d is Extract<typeof d, { kind: "declined" }> => d.kind === "declined")
    .map((d) => d.name);
  const rec = recommendedColumn(p);
  const confirmed = confirmedFieldNames(p);
  const blockers: string[] = [];
  if (!(p.clientName ?? "").trim()) blockers.push("Add the client name on the Setup step.");
  if (!included.length) blockers.push("Upload at least one quote before generating.");
  if (confirmed.length < 4) blockers.push(`Confirm the four key values on the Review step (${4 - confirmed.length} remaining).`);
  return {
    clientName: (p.clientName ?? "").trim(),
    reference: (p.ref ?? "").trim(),
    kind: projectKind(p),
    coverTitle: coverTitle(p),
    included,
    declined,
    hasExpiring: columns.some((c) => c.expiring),
    recommended: rec?.name ?? null,
    buyerCount: creditRows(p).filter(rowHasContent).length,
    confirmedCount: confirmed.length,
    blockers,
  };
}

// ── Payload ─────────────────────────────────────────────────────────────

function columnValues(p: ProjectState, col: ProjectColumn): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of FIELDS) values[f.key] = cellValue(p, col, f) || "";
  return values;
}

/** Reasons text as the deck expects it: one point per line, key differences appended. */
export function reasonsText(p: ProjectState): string {
  const s = p as ExportProjectState;
  const points = reasonPoints(typeof s.reasons === "string" ? s.reasons : "");
  const diffs = reasonPoints(typeof s.keyDifferences === "string" ? s.keyDifferences : "");
  return [...points, ...diffs.map((d) => `Key difference: ${d}`)].join("\n");
}

/**
 * The BRD 2.8 request. Columns follow the presentation order (expiring
 * policy first, then setup tick order); declined insurers are derived
 * server-side from `approached_insurers` minus the columns; fully empty
 * credit-limit rows are dropped so an untouched "Add buyer" row does not
 * force the credit-limit slide in.
 */
export function buildPresentationRequest(p: ProjectState, insurers: Insurer[]): PresentationRequest {
  const s = p as ExportProjectState;
  const ordered = displayColumns(p, insurers)
    .filter((d): d is Extract<typeof d, { kind: "column" }> => d.kind === "column")
    .map((d) => d.col);
  const columnIds = new Set(ordered.map((c) => c.id));
  const approached: string[] = Array.isArray(p.approached) ? (p.approached as string[]) : [];
  return {
    client_name: (p.clientName ?? "").trim() || "Client",
    reference: (p.ref ?? "").trim(),
    project_type: projectKind(p),
    columns: ordered.map((col) => ({ id: col.id, name: col.name, matched: col.matched ?? null, values: columnValues(p, col) })),
    recommended_id: s.recommended && columnIds.has(s.recommended) ? s.recommended : null,
    approached_insurers: approached.map((id) => insurers.find((i) => i.id === id)?.name ?? id),
    credit_limits: hasLimitData(p)
      ? creditRows(p)
          .filter(rowHasContent)
          .map((r) => ({
            buyer: r.buyer ?? "",
            company_number: r.reg ?? "",
            required: r.req ?? "",
            offers: Object.fromEntries(Object.entries(r.offers ?? {}).filter(([colId, v]) => columnIds.has(colId) && v)),
          }))
      : [],
    notes: typeof s.notes === "string" ? s.notes : "",
    reasons: reasonsText(p),
    confirmed_fields: confirmedFieldNames(p),
  };
}

/** Edit rate (BRD §5): of the AI-extracted values, how many the broker changed. */
export function editStats(p: ProjectState): { fieldsTotal: number; fieldsEdited: number; prepSeconds?: number } {
  let total = 0;
  let edited = 0;
  for (const col of projectColumns(p)) {
    if (col.manual) continue;
    for (const f of FIELDS) {
      if (f.set || f.manual) continue;
      const sv = col.data?.[f.key];
      if (!sv || !("orig" in sv) || (sv.orig ?? "") === "") continue;
      total += 1;
      if (cellEdited(col, f)) edited += 1;
    }
  }
  const created = typeof p.created === "number" ? p.created : null;
  return { fieldsTotal: total, fieldsEdited: edited, prepSeconds: created ? Math.round((Date.now() - created) / 1000) : undefined };
}

// ── Generation state ────────────────────────────────────────────────────

export function generatedAt(p: ProjectState): number | null {
  const g = (p as ExportProjectState).generatedAt;
  return typeof g === "number" ? g : null;
}

/** Edits after the last generation: previous downloads no longer match. */
export function isSuperseded(p: ProjectState): boolean {
  const g = generatedAt(p);
  if (!g) return false;
  const u = typeof p.updated === "number" ? p.updated : 0;
  return u > g + 1000;
}

/** After a successful generation: status flips to Generated, files exist. */
export function markGenerated(p: ProjectState): ExportProjectState {
  const now = Date.now();
  return { ...(p as ExportProjectState), status: "ready", exported: true, generatedAt: now, updated: now };
}
