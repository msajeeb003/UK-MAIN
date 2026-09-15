/**
 * S4 upload domain: the per-file entries kept in the project state, the
 * rules for accepting files into a slot, and `applyExtraction`, which
 * folds an extraction result into the comparison columns and credit-limit
 * rows. Pure functions over ProjectState; persistence is the caller's job.
 *
 * The state shape is shared with the review screen and mirrors the one
 * the earlier SPA saved, so projects created there still load.
 */
import type { BuyerCreditLimit, DocKind, ExtractionResponse, ProjectState } from "@/lib/api/types";
import { DOC_TYPE_LABELS, EXTRACTED_FIELD_KEYS, MAX_QUOTES } from "@/lib/fields";

export type FileStatus = "uploading" | "queued" | "processing" | "extracted" | "error";

export interface ProjectFile {
  id: string;
  name: string;
  kind: DocKind;
  /** Short upper-case extension for the file badge. */
  ext: string;
  status: FileStatus;
  /** One-line summary shown under the file name. */
  meta: string;
  /** Backend job id while the extraction is in flight (poll to resume). */
  jobId?: string | null;
  /** Retained document id once extracted. */
  docId?: string | null;
  /** Comparison column this quote feeds. */
  colId?: string | null;
  addedAt?: number;
  /** Progress of the upload request itself (0-100), while uploading. */
  progress?: number;
}

export interface CellValue {
  value: string;
  /** The AI's original value, kept so the edit rate can be measured (BRD §5). */
  orig?: string;
  page?: number | null;
  conf?: string | null;
}

export interface ProjectColumn {
  id: string;
  name: string;
  manual: boolean;
  expiring: boolean;
  fileName?: string;
  docId?: string | null;
  /** Page count of the retained document (source viewer navigation). */
  pages?: number | null;
  data: Record<string, CellValue>;
  /** Debt-collection rule result ("Included" | "Outsourced"), editable. */
  debt: string;
  /** Standing-list insurer name the backend matched, if any. */
  matched?: string | null;
}

export interface CreditRow {
  id: string;
  buyer: string;
  reg: string;
  req: string;
  offers: Record<string, string>;
  /** Offers that arrived before their insurer's column existed. */
  pending?: Record<string, string>;
}

export interface UploadProjectState extends ProjectState {
  files?: ProjectFile[];
  columns?: ProjectColumn[];
  credit?: CreditRow[];
}

export const DOC_KIND_META: Record<DocKind, { title: string; hint: string; accept: string; multiple: boolean }> = {
  quote: {
    title: "Quotes",
    hint: `PDF, including scanned. One to ${MAX_QUOTES} per project.`,
    accept: ".pdf,application/pdf",
    multiple: true,
  },
  limits: {
    title: "Credit-limit documents",
    hint: "PDF or Excel schedules. Optional; some insurers attach limits to the quote.",
    accept: ".pdf,.xlsx,.xlsm,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.ms-excel",
    multiple: true,
  },
  expiring: {
    title: "Expiring policy",
    hint: "Renewals only. Uploaded as the comparison baseline.",
    accept: ".pdf,application/pdf",
    multiple: false,
  },
};

const ACCEPTED_EXT: Record<DocKind, readonly string[]> = {
  quote: ["pdf"],
  limits: ["pdf", "xlsx", "xlsm", "xls"],
  expiring: ["pdf"],
};

export function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
}

export function fileExt(name: string): string {
  return (name.split(".").pop() || "PDF").toUpperCase().slice(0, 4);
}

export function kindLabel(kind: DocKind): string {
  return kind === "limits" ? "credit-limit doc" : kind === "expiring" ? "expiring policy" : "quote";
}

export function projectFiles(p: UploadProjectState): ProjectFile[] {
  return Array.isArray(p.files) ? p.files : [];
}

export function isInFlight(f: ProjectFile): boolean {
  return f.status === "uploading" || f.status === "queued" || f.status === "processing";
}

export function quoteSlotsUsed(p: UploadProjectState): number {
  return projectFiles(p).filter((f) => f.kind === "quote" && f.status !== "error").length;
}

export interface UploadPlan {
  accepted: File[];
  /** Per-file reasons for rejection, in the user's words. */
  rejected: { file: File; reason: string }[];
  /** Filenames of failed earlier attempts that this batch retries. */
  retried: string[];
}

/**
 * Decide which dropped files enter a slot: wrong types are rejected,
 * exact duplicates skipped (a previous FAILED attempt is re-tried instead),
 * the quote cap is enforced, and the expiring slot holds one file.
 */
export function planUploads(p: UploadProjectState, kind: DocKind, incoming: File[]): UploadPlan {
  const plan: UploadPlan = { accepted: [], rejected: [], retried: [] };
  const existing = projectFiles(p);
  const seen = new Set<string>();

  for (const file of incoming) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!ACCEPTED_EXT[kind].includes(ext)) {
      plan.rejected.push({ file, reason: `Not accepted here (${ACCEPTED_EXT[kind].map((e) => e.toUpperCase()).join(", ")} only)` });
      continue;
    }
    const key = `${kind}:${file.name}`;
    if (seen.has(key)) {
      plan.rejected.push({ file, reason: "Listed twice in this batch" });
      continue;
    }
    seen.add(key);
    const prior = existing.find((e) => e.kind === kind && e.name === file.name);
    if (prior && prior.status !== "error") {
      plan.rejected.push({
        file,
        reason: "Already uploaded. To replace a quote with a newer version, upload it under a different file name.",
      });
      continue;
    }
    if (prior?.status === "error") plan.retried.push(file.name);
    plan.accepted.push(file);
  }

  if (kind === "quote") {
    const room = MAX_QUOTES - quoteSlotsUsed(p);
    if (plan.accepted.length > room) {
      for (const file of plan.accepted.slice(Math.max(room, 0))) {
        plan.rejected.push({ file, reason: `Up to ${MAX_QUOTES} quotes per project` });
      }
      plan.accepted = plan.accepted.slice(0, Math.max(room, 0));
    }
  }
  if (kind === "expiring" && plan.accepted.length > 1) {
    for (const file of plan.accepted.slice(1)) {
      plan.rejected.push({ file, reason: "Only one expiring policy per renewal" });
    }
    plan.accepted = plan.accepted.slice(0, 1);
  }
  return plan;
}

/** A fresh entry for a file about to be uploaded (replaces a failed one). */
export function addFileEntry(p: UploadProjectState, kind: DocKind, file: File): { project: UploadProjectState; entry: ProjectFile } {
  const entry: ProjectFile = {
    id: uid(),
    name: file.name,
    kind,
    ext: fileExt(file.name),
    status: "uploading",
    meta: `${kindLabel(kind)} · uploading…`,
    jobId: null,
    addedAt: Date.now(),
    progress: 0,
  };
  const files = projectFiles(p).filter((e) => !(e.kind === kind && e.name === file.name && e.status === "error"));
  // An expiring policy is single-slot: a new upload replaces the old entry.
  const kept = kind === "expiring" ? files.filter((e) => e.kind !== "expiring") : files;
  return { project: { ...p, files: [...kept, entry], updated: Date.now() }, entry };
}

export function updateFileEntry(p: UploadProjectState, id: string, patch: Partial<ProjectFile>): UploadProjectState {
  return {
    ...p,
    files: projectFiles(p).map((f) => (f.id === id ? { ...f, ...patch } : f)),
    updated: Date.now(),
  };
}

export function removeFileEntry(p: UploadProjectState, id: string): UploadProjectState {
  return { ...p, files: projectFiles(p).filter((f) => f.id !== id), updated: Date.now() };
}

// ── Folding an extraction result into the comparison ─────────────────────

function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

function mergeBuyers(credit: CreditRow[], colId: string | null, buyers: BuyerCreditLimit[] | undefined, pendKey: string | null): CreditRow[] {
  const rows: CreditRow[] = credit.map((r) => ({
    ...r,
    offers: { ...r.offers },
    pending: r.pending ? { ...r.pending } : undefined,
  }));
  for (const b of buyers ?? []) {
    if (!b.buyer_name && !b.company_number) continue;
    let row: CreditRow | undefined = rows.find(
      (r) => (b.company_number && r.reg === b.company_number) || (b.buyer_name && lower(r.buyer) === lower(b.buyer_name)),
    );
    if (!row) {
      row = { id: uid(), buyer: b.buyer_name ?? "", reg: b.company_number ?? "", req: "", offers: {} };
      rows.push(row);
    }
    if (!row.reg && b.company_number) row.reg = b.company_number;
    if (!row.req && b.limit_required) row.req = b.limit_required;
    if (colId && b.limit_offered) {
      row.offers[colId] = b.limit_offered;
    } else if (pendKey && b.limit_offered) {
      // Schedule arrived before its quote: park the offer under the
      // insurer's key so it attaches when that column is created.
      row.pending = { ...(row.pending ?? {}), [pendKey]: b.limit_offered };
    }
  }
  return rows;
}

/** Attach offers parked by mergeBuyers once the insurer's column exists. */
function attachPendingOffers(credit: CreditRow[], col: ProjectColumn): CreditRow[] {
  const keys = [col.matched, col.name].filter(Boolean).map((k) => lower(k as string));
  return credit.map((row) => {
    if (!row.pending) return row;
    const offers = { ...row.offers };
    const pending = { ...row.pending };
    for (const key of Object.keys(pending)) {
      if (keys.some((k) => k === key || k.includes(key) || key.includes(k))) {
        if (!offers[col.id]) offers[col.id] = pending[key];
        delete pending[key];
      }
    }
    return { ...row, offers, pending: Object.keys(pending).length ? pending : undefined };
  });
}

function findInsurerColumn(columns: ProjectColumn[], matched: string | null, insurer: string | null): ProjectColumn | null {
  return (
    (matched && columns.find((c) => c.matched === matched)) ||
    (insurer && columns.find((c) => lower(c.name).includes(lower(insurer)) || lower(insurer).includes(lower(c.name)))) ||
    null
  );
}

/**
 * Fold a finished extraction into the project: mark the file entry, and
 * either add/refresh the insurer's comparison column (quotes, expiring
 * policy) or attach buyer credit limits (schedules). Mirrors the rules the
 * backend and BRD 2.1/2.4 define; see comments inline.
 */
export function applyExtraction(p: UploadProjectState, entryId: string, body: ExtractionResponse, kind: DocKind): UploadProjectState {
  const d = body.data;
  const insurer = d.insurer?.value || null;
  // Standing-list name the server's alias matching resolved (e.g. a Zurich
  // schedule issued as "The Marine Insurance Company Limited" -> "Zurich").
  const matched = body.set_fields?.debt_collection_support?.matched_insurer ?? null;
  const uncertain = body.review?.uncertain_fields?.length ?? 0;

  let columns = [...(Array.isArray(p.columns) ? p.columns : [])];
  let credit = Array.isArray(p.credit) ? p.credit : [];

  const matchNote = matched && insurer && lower(matched) !== lower(insurer) ? ` (matched: ${matched})` : "";
  let meta =
    (insurer || "Unrecognised insurer") +
    matchNote +
    " · " +
    (DOC_TYPE_LABELS[d.document_type] || kindLabel(kind)) +
    (body.meta.extraction_engine === "azure_document_intelligence" ? " (scanned)" : "") +
    ` · ${body.meta.page_count} page${body.meta.page_count === 1 ? "" : "s"}` +
    (uncertain ? ` · ${uncertain} value${uncertain === 1 ? "" : "s"} to verify` : "");
  const docId = body.meta.document_id ?? null;
  let colId: string | null = null;

  // A credit-limit schedule never becomes a comparison column, even when it
  // arrives through the quotes slot. Its offers attach to the column of the
  // same insurer, matched by standing-list name first.
  if (kind === "limits" || d.document_type === "credit_limit_schedule") {
    const col = findInsurerColumn(columns, matched, insurer);
    credit = mergeBuyers(credit, col ? col.id : null, d.buyer_credit_limits, lower(matched || insurer || "") || null);
    if (col) meta += ` · limits added to ${col.name}`;
    const files = projectFiles(p).map((f) =>
      f.id === entryId ? { ...f, status: "extracted" as const, meta, docId, jobId: null, progress: undefined } : f,
    );
    return { ...p, files, columns, credit, updated: Date.now() };
  }

  // BRD 2.4: debt collection support comes from the server-side insurer
  // rule, never extracted; editable per column at review.
  const ruleDebt = body.set_fields?.debt_collection_support?.value ?? "Outsourced";
  const entry = projectFiles(p).find((f) => f.id === entryId);
  const colName = kind === "expiring" ? `Expiring — ${insurer || "policy"}` : insurer || (entry?.name ?? "Quote").replace(/\.pdf$/i, "");

  const freshData: Record<string, CellValue> = {};
  for (const key of EXTRACTED_FIELD_KEYS) {
    const sv = (d as unknown as Record<string, { value: string | null; page: number | null; confidence: string | null } | undefined>)[key];
    if (sv && typeof sv === "object") {
      freshData[key] = { value: sv.value ?? "", orig: sv.value ?? "", page: sv.page, conf: sv.confidence };
    }
  }

  // One automatic column per insurer (BRD 2.1). A duplicate or newer upload
  // UPDATES the existing column in place, keeping its id so the
  // recommendation and credit-limit offers stay linked.
  const existing = columns.find((c) => !c.manual && lower(c.name) === lower(colName));
  if (existing) {
    const updatedCol: ProjectColumn = { ...existing, data: freshData, debt: ruleDebt, matched, docId, pages: body.meta.page_count, fileName: entry?.name };
    columns = columns.map((c) => (c.id === existing.id ? updatedCol : c));
    colId = existing.id;
    meta += " · updated existing column";
    credit = attachPendingOffers(mergeBuyers(credit, existing.id, d.buyer_credit_limits, null), updatedCol);
  } else {
    const col: ProjectColumn = {
      id: uid(),
      name: colName,
      manual: false,
      expiring: kind === "expiring",
      fileName: entry?.name,
      docId,
      pages: body.meta.page_count,
      data: freshData,
      debt: ruleDebt,
      matched,
    };
    columns = kind === "expiring" ? [col, ...columns] : [...columns, col];
    colId = col.id;
    credit = attachPendingOffers(mergeBuyers(credit, col.id, d.buyer_credit_limits, null), col);
  }

  const files = projectFiles(p).map((f) =>
    f.id === entryId ? { ...f, status: "extracted" as const, meta, docId, colId, jobId: null, progress: undefined } : f,
  );
  // BRD 2.5: the confirmation gate applies to whichever quotes are in. A
  // new or refreshed column changes the comparison, so the four key values
  // must be confirmed again and the "reviewed all columns" tick is cleared.
  return { ...p, files, columns, credit, confirmed: {}, reviewed: false, updated: Date.now() };
}
