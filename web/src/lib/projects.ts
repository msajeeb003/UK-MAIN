/**
 * Project-list domain helpers (BRD 2.9 / S2): status, type, dates, the
 * close/reopen transitions and the new-project factory. The backend stores
 * the project as an opaque blob, so these rules live in the frontend.
 */
import type { ExportFormat, ProjectState } from "@/lib/api/types";

export type ProjectStatus = "draft" | "ready" | "sent" | "closed";

export const PROJECT_STATUSES: readonly ProjectStatus[] = ["draft", "ready", "sent", "closed"];

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; hint: string }> = {
  draft: { label: "Draft", hint: "In preparation; nothing generated yet" },
  ready: { label: "Ready", hint: "Presentation generated; proofread and send" },
  sent: { label: "Sent", hint: "Presentation sent to the client" },
  closed: { label: "Closed", hint: "Closed; reopen to return to the review screen" },
};

export type ProjectTypeFilter = "all" | "new" | "renewal";

export const EXPORT_FORMATS: readonly { format: ExportFormat; label: string; short: string }[] = [
  { format: "pptx", label: "PowerPoint", short: "PPT" },
  { format: "pdf", label: "PDF", short: "PDF" },
  { format: "limits-xlsx", label: "Credit limits (Excel)", short: "XLSX" },
];

function isStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}

/** Effective status, tolerant of projects saved by the older SPA. */
export function projectStatus(p: ProjectState): ProjectStatus {
  if (isStatus(p.status)) return p.status;
  return p.exported ? "ready" : "draft";
}

export function isClosed(p: ProjectState): boolean {
  return projectStatus(p) === "closed";
}

/** Reports exist once a presentation has been generated. */
export function hasReports(p: ProjectState): boolean {
  return Boolean(p.exported);
}

export function projectTypeLabel(p: ProjectState): string {
  return p.projectType === "renewal" ? "Renewal" : "New business";
}

/** Sort key. `updated` is epoch ms here; the older SPA stored a label. */
export function updatedTimestamp(p: ProjectState): number {
  if (typeof p.updated === "number") return p.updated;
  if (typeof p.created === "number") return p.created;
  return 0;
}

/** Wireframe list date: "12 Aug" (the year is added once it is not the current one). */
export function formatUpdated(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const date = new Date(value);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
  }
  if (typeof value === "string") return value;
  return "";
}

/** Full timestamp for tooltips and the export screen. */
export function formatUpdatedFull(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }
  if (typeof value === "string") return value;
  return "";
}

export function closeProject(p: ProjectState): ProjectState {
  return {
    ...p,
    status: "closed",
    closedFrom: projectStatus(p) === "closed" ? p.closedFrom : projectStatus(p),
    closedAt: Date.now(),
    updated: Date.now(),
  };
}

/** Restore the pre-close status (BRD 2.9: past projects are reopenable). */
export function reopenProject(p: ProjectState): ProjectState {
  const previous = isStatus(p.closedFrom) && p.closedFrom !== "closed" ? p.closedFrom : null;
  const { closedFrom: _closedFrom, closedAt: _closedAt, ...rest } = p;
  void _closedFrom;
  void _closedAt;
  return {
    ...rest,
    status: previous ?? (p.exported ? "ready" : "draft"),
    updated: Date.now(),
  };
}

function newProjectId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function newProjectState(): ProjectState {
  const now = Date.now();
  return {
    id: newProjectId(),
    clientName: "",
    ref: "",
    projectType: "new",
    policyType: "Whole Turnover",
    status: "draft",
    exported: false,
    created: now,
    updated: now,
    confirmed: {},
    recommended: null,
  };
}
