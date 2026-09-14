/**
 * Typed endpoint functions, grouped by backend router. Each maps 1:1 onto a
 * FastAPI route (see the root README "API" section and backend/app/api/*.py).
 */
import { buildUrl, http, requestBlob } from "./client";
import type {
  ClientErrorReport,
  DocKind,
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
  ProjectsResponse,
  ProjectState,
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
export const projectsApi = {
  list: () => http.get<ProjectsResponse>("/projects").then((r) => r.projects),

  save: (state: ProjectState) => http.post<OkResponse>("/projects", { id: state.id, state }),

  remove: (projectId: string) =>
    http.delete<OkResponse>(`/projects/${encodeURIComponent(projectId)}`),

  /** URL of the latest generated export of a format (needs the Bearer token). */
  exportUrl: (projectId: string, format: ExportFormat) =>
    buildUrl(`/projects/${encodeURIComponent(projectId)}/exports/${format}`),

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
