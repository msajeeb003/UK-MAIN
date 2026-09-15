/**
 * Typed endpoint functions, grouped by backend router. Each maps 1:1 onto a
 * FastAPI route (see the root README "API" section and backend/app/api/*.py).
 */
import { buildUrl, http, requestBlob } from "./client";
import type {
  PresentationWording,
  ClientErrorReport,
  DocKind,
  DocumentBatch,
  DocumentRecord,
  DownloadedFile,
  ExportFormat,
  ExtractJob,
  ExtractionResponse,
  HealthResponse,
  InsurersResponse,
  MeResponse,
  OkResponse,
  PresentationRequest,
  PresentationStats,
  ProjectPage,
  ProjectResource,
  ProjectSearch,
  ProjectState,
  ProjectStatus,
  ProjectWrite,
  SessionUser,
} from "./types";

// ── /auth ───────────────────────────────────────────────────────────────
// Sign-in and sign-out happen against Supabase Auth (see
// components/providers/session-provider.tsx). The backend only needs to
// confirm it accepts our access token.
export const authApi = {
  /** Who the backend thinks we are, given the current Supabase access token. */
  async me(): Promise<SessionUser> {
    const res = await http.get<MeResponse>("/auth/me", { sessionBound: false });
    return { id: null, email: res.email, name: res.name };
  },
};

// ── /insurers ───────────────────────────────────────────────────────────
export const insurersApi = {
  list: () => http.get<InsurersResponse>("/insurers").then((r) => r.insurers),
};

// ── /projects ───────────────────────────────────────────────────────────
// The backend keeps a project as a relational resource (searchable columns
// + the ordered insurers-approached relation) with the broker's working
// document under `state`. The screens keep working on the flat
// ProjectState, so the mapping lives here and nowhere else.
const STATUSES: readonly ProjectStatus[] = ["draft", "ready", "sent", "closed"];
const PAGE_SIZE = 200;

/** ProjectState keys that are columns / the relation on the server, not part of `state`. */
const COLUMN_KEYS = ["id", "clientName", "ref", "projectType", "policyType", "approached", "status", "generatedAt"] as const;

function toWrite(state: ProjectState): ProjectWrite {
  const { clientName, ref, projectType, policyType, approached, status, generatedAt } = state;
  const rest: Record<string, unknown> = { ...state };
  for (const key of COLUMN_KEYS) delete rest[key];
  return {
    client_name: clientName ?? "",
    reference: ref ?? "",
    project_type: projectType ?? null,
    policy_type: policyType ?? null,
    status: STATUSES.includes(status as ProjectStatus) ? (status as ProjectStatus) : "draft",
    insurers_approached: approached ?? [],
    generated_at: typeof generatedAt === "number" ? new Date(generatedAt).toISOString() : null,
    state: rest,
  };
}

export function fromResource(r: ProjectResource): ProjectState {
  const state = r.state as Partial<ProjectState>;
  return {
    ...state,
    id: r.id,
    clientName: r.client_name,
    ref: r.reference,
    projectType: r.project_type ?? undefined,
    policyType: r.policy_type ?? undefined,
    approached: r.insurers_approached.map((i) => i.id),
    status: r.status,
    generatedAt: r.generated_at ? Date.parse(r.generated_at) : undefined,
    created: typeof state.created === "number" ? state.created : Date.parse(r.created_at),
    updated: state.updated ?? Date.parse(r.updated_at),
  };
}

function searchQuery(search: ProjectSearch, limit: number, offset: number): Record<string, string | string[] | number> {
  const query: Record<string, string | string[] | number> = { limit, offset };
  if (search.q) query.q = search.q;
  if (search.status?.length) query.status = search.status;
  if (search.projectType) query.project_type = search.projectType;
  if (search.insurer) query.insurer = search.insurer;
  if (search.sort) query.sort = search.sort;
  return query;
}

export const projectsApi = {
  /** Every project (BRD 2.10: all named users see all projects), newest first. */
  async list(search: ProjectSearch = {}): Promise<ProjectState[]> {
    const items: ProjectResource[] = [];
    let offset = 0;
    for (;;) {
      const page = await http.get<ProjectPage>("/projects", { query: searchQuery(search, PAGE_SIZE, offset) });
      items.push(...page.items);
      offset += page.items.length;
      if (offset >= page.total || page.items.length === 0) break;
    }
    return items.map(fromResource);
  },

  /** One page of a search — for a server-side paged list. */
  search: (search: ProjectSearch, limit = 50, offset = 0) =>
    http.get<ProjectPage>("/projects", { query: searchQuery(search, limit, offset) }),

  get: (projectId: string) =>
    http.get<ProjectResource>(`/projects/${encodeURIComponent(projectId)}`).then(fromResource),

  /** Create-or-replace at the state's id (PUT). Returns the stored state. */
  save: (state: ProjectState) =>
    http.put<ProjectResource>(`/projects/${encodeURIComponent(state.id)}`, toWrite(state)).then(fromResource),

  remove: (projectId: string) =>
    http.delete<void>(`/projects/${encodeURIComponent(projectId)}`),

  /** URL of the latest generated export of a format (needs the Bearer token). */
  exportUrl: (projectId: string, format: ExportFormat) =>
    buildUrl(`/projects/${encodeURIComponent(projectId)}/exports/${format}`),

  /** One page of the latest generated PDF as an image (S8 preview). */
  async exportPdfPage(projectId: string, page: number, signal?: AbortSignal): Promise<{ blob: Blob; pageCount: number | null }> {
    const { blob, headers } = await requestBlob(
      `/projects/${encodeURIComponent(projectId)}/exports/pdf/page/${page}`,
      { signal, timeoutMs: 30_000 },
    );
    const count = Number(headers.get("x-page-count"));
    return { blob, pageCount: Number.isFinite(count) && count > 0 ? count : null };
  },

  /**
   * Fetch the latest generated export as a file. Goes through the client
   * (not a plain link) so the Authorization header is attached.
   */
  async downloadExport(projectId: string, format: ExportFormat): Promise<DownloadedFile> {
    const { blob, filename } = await requestBlob(
      `/projects/${encodeURIComponent(projectId)}/exports/${format}`,
      { timeoutMs: 2 * 60_000 },
    );
    const ext = format === "limits-xlsx" ? "xlsx" : format;
    return { blob, filename: filename ?? `${projectId}.${ext}` };
  },
};

// ── /documents ──────────────────────────────────────────────────────────
export const documentsApi = {
  /**
   * Upload one or more files into a slot (HTTP 202). Every file comes back
   * as a record in request order: `pending` with a `job_id` to poll, or
   * `failed` with the reason when it was rejected up front.
   */
  async upload(projectId: string, slot: DocKind, files: File[], signal?: AbortSignal): Promise<DocumentRecord[]> {
    const formData = new FormData();
    for (const file of files) formData.append("files", file);
    formData.append("slot", slot);
    const res = await http.post<DocumentBatch>(`/projects/${encodeURIComponent(projectId)}/documents`, undefined, {
      formData,
      signal,
      timeoutMs: 5 * 60_000,
    });
    return res.documents;
  },

  /** The project's document records (optionally one slot). */
  list: (projectId: string, slot?: DocKind) =>
    http
      .get<DocumentBatch>(`/projects/${encodeURIComponent(projectId)}/documents`, { query: { slot } })
      .then((r) => r.documents),

  /** One record — poll it for the processing status. */
  get: (projectId: string, documentId: string, signal?: AbortSignal) =>
    http.get<DocumentRecord>(`/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}`, { signal }),

  /** Run the pipeline again on the stored file (broker edits survive). */
  rerun: (projectId: string, documentId: string) =>
    http.post<DocumentRecord>(`/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/rerun`),

  /** Remove the record and its stored file. */
  remove: (projectId: string, documentId: string) =>
    http.delete<void>(`/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}`),

  /** Rendered page image of a retained document (source-page chips). */
  pageImageUrl: (documentId: string, page: number) =>
    buildUrl(`/documents/${encodeURIComponent(documentId)}/page/${page}`),

  /**
   * Fetch the rendered page as a Blob (an <img src> cannot carry the
   * Bearer token). Caller owns the object URL it creates from it. The
   * backend reports the document's page count in X-Page-Count.
   */
  async pageImage(
    documentId: string,
    page: number,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob; pageCount: number | null }> {
    const { blob, headers } = await requestBlob(
      `/documents/${encodeURIComponent(documentId)}/page/${page}`,
      { signal, timeoutMs: 30_000 },
    );
    const count = Number(headers.get("x-page-count"));
    return { blob, pageCount: Number.isFinite(count) && count > 0 ? count : null };
  },
};

// ── /extract-quote ──────────────────────────────────────────────────────
export interface ExtractQuoteInput {
  file: File;
  projectId: string;
  docKind: DocKind;
  signal?: AbortSignal;
}

export const extractionApi = {
  extractQuote({ file, projectId, docKind, signal }: ExtractQuoteInput) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("project_id", projectId);
    formData.append("doc_kind", docKind);
    return http.post<ExtractionResponse>("/extract-quote", undefined, {
      formData,
      signal,
      timeoutMs: 5 * 60_000, // OCR + LLM extraction on a 60-page PDF
    });
  },

  /**
   * Queue an extraction and return at once (HTTP 202). Poll `getJob` for
   * queued → processing → done | error. Preferred over `extractQuote`:
   * the request returns in milliseconds, so gateways never time out and
   * a reloaded tab can pick the job back up.
   */
  startJob({ file, projectId, docKind, signal }: ExtractQuoteInput) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("project_id", projectId);
    formData.append("doc_kind", docKind);
    return http.post<ExtractJob>("/extract-jobs", undefined, {
      formData,
      signal,
      timeoutMs: 2 * 60_000, // upload time only
    });
  },

  getJob: (jobId: string, signal?: AbortSignal) =>
    http.get<ExtractJob>(`/extract-jobs/${encodeURIComponent(jobId)}`, { signal, timeoutMs: 15_000 }),
};

// ── /generate-presentation ──────────────────────────────────────────────
export const presentationApi = {
  /** The fixed wording the deck renders, so the S7 preview matches it exactly. */
  wording: () => http.get<PresentationWording>("/presentation/wording"),
  async generate(
    format: ExportFormat,
    projectId: string,
    payload: PresentationRequest,
    stats: PresentationStats,
  ): Promise<DownloadedFile> {
    const { blob, filename } = await requestBlob("/generate-presentation", {
      method: "POST",
      body: payload,
      timeoutMs: 3 * 60_000,
      query: {
        format,
        project_id: projectId,
        fields_total: stats.fieldsTotal,
        fields_edited: stats.fieldsEdited,
        prep_seconds: stats.prepSeconds,
      },
    });
    const ext = format === "limits-xlsx" ? "xlsx" : format;
    return { blob, filename: filename ?? `${payload.client_name || "presentation"}.${ext}` };
  },
};

// ── Observability ───────────────────────────────────────────────────────
export const systemApi = {
  health: () => http.get<HealthResponse>("/health"),
  /** Best-effort; never throws. */
  reportClientError: (report: ClientErrorReport) =>
    http.post<OkResponse>("/client-error", report).catch(() => undefined),
};
