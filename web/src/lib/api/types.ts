/**
 * Wire types for the FastAPI backend. Field names are the backend's
 * (snake_case) so a response can be used without a mapping layer.
 * Source of truth: backend/app/models/*.py and backend/app/api/*.py.
 */

// ── Auth ────────────────────────────────────────────────────────────────
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  ok: true;
  csrf_token: string;
}

export interface MeResponse {
  email: string;
  name: string;
  csrf_token: string;
}

export interface SessionUser {
  /** Supabase user id; null when the identity came from the backend only. */
  id: string | null;
  email: string;
  name: string;
}

// ── Configuration ───────────────────────────────────────────────────────
export interface Insurer {
  id: string;
  name: string;
  /** BRD 2.4 debt-collection rule. */
  debt_collection: "included" | "outsourced";
  aliases?: string[];
}

export interface InsurersResponse {
  insurers: Insurer[];
}

// ── Projects ────────────────────────────────────────────────────────────
/**
 * The backend stores the project as an opaque JSON blob owned by the
 * frontend. Only the keys the server itself reads are typed here.
 */
export interface ProjectState {
  id: string;
  clientName?: string;
  ref?: string;
  projectType?: "new" | "renewal";
  policyType?: string;
  /** Ids from the standing insurer list (GET /insurers) the broker approached. */
  approached?: string[];
  /** draft | ready | sent | closed — see lib/projects.ts. */
  status?: string;
  /** True once a presentation has been generated (download links exist). */
  exported?: boolean;
  /** Epoch ms of the last successful generation (S8). */
  generatedAt?: number;
  /** Status before the project was closed, restored on reopen. */
  closedFrom?: string;
  closedAt?: number;
  created?: number;
  /** Epoch ms in this app; the older SPA stored a display label. */
  updated?: number | string;
  confirmed?: Record<string, boolean>;
  recommended?: string | null;
  [key: string]: unknown;
}

export type ProjectStatus = "draft" | "ready" | "sent" | "closed";

/** One approached insurer as the API returns it (name resolved server-side). */
export interface InsurerRef {
  id: string;
  name: string;
  position: number;
}

/** The project resource of the relational store (GET /projects/{id}). */
export interface ProjectResource {
  id: string;
  client_name: string;
  reference: string;
  project_type: "new" | "renewal" | null;
  policy_type: string | null;
  status: ProjectStatus;
  insurers_approached: InsurerRef[];
  owner_email: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  generated_at: string | null;
  /** Derived: processing while any upload is still running, else ready. */
  processing_status: "processing" | "ready";
  documents: { processing: number; ready: number; unreadable: number };
  /** The working document (everything in ProjectState that is not a column). */
  state: Record<string, unknown>;
}

/** Body of PUT /projects/{id} (full replace) and POST /projects. */
export interface ProjectWrite {
  client_name: string;
  reference: string;
  project_type: "new" | "renewal" | null;
  policy_type: string | null;
  status: ProjectStatus;
  insurers_approached: string[];
  generated_at: string | null;
  state: Record<string, unknown>;
}

export interface ProjectPage {
  items: ProjectResource[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProjectSearch {
  q?: string;
  status?: ProjectStatus[];
  projectType?: "new" | "renewal";
  insurer?: string;
  sort?: "updated_desc" | "updated_asc" | "client_asc" | "client_desc" | "created_desc" | "created_asc";
}

export interface OkResponse {
  ok: true;
}

// ── Extraction (POST /extract-quote) ────────────────────────────────────
export type Confidence = "high" | "medium" | "low";

export interface SourcedValue {
  value: string | null;
  page: number | null;
  confidence: Confidence | null;
}

export interface BuyerCreditLimit {
  buyer_name: string | null;
  company_number: string | null;
  limit_required: string | null;
  limit_offered: string | null;
  page: number | null;
}

export type DocumentType =
  | "insurer_quote"
  | "credit_limit_schedule"
  | "policy_document"
  | "other";

export type DocKind = "quote" | "expiring" | "limits";

/** Per-file processing status of an upload (POST /projects/{id}/documents). */
export type DocumentStatus = "uploaded" | "processing" | "ready" | "unreadable";

/** One uploaded file's record: where it is and how far processing got. */
export interface DocumentRecord {
  id: string;
  project_id: string;
  slot: DocKind;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: DocumentStatus;
  /** queued | extracting | retrying | done | failed | rejected | storage */
  stage: string;
  /** Why the document is unreadable. */
  error: string | null;
  page_count: number;
  attempts: number;
  /** Per-step timings of the last run: {step, ms, ok, detail}. */
  timings: { step: string; ms: number; ok: boolean; detail: string }[];
  /** Extraction job to poll for the result while the record is pending/processing. */
  job_id: string | null;
  storage_backend: string;
  uploaded_by: string;
  uploaded_at: string;
  updated_at: string;
  processed_at: string | null;
}

export interface DocumentBatch {
  documents: DocumentRecord[];
  /** processing while any document is still running, else ready. */
  processing_status: "processing" | "ready";
}

/** The extracted fields (BRD 16-field list minus the two set fields). */
export type ExtractedFieldKey =
  | "insurer"
  | "annual_turnover"
  | "premium_rate"
  | "estimated_annual_premium_exc_ipt"
  | "minimum_annual_premium"
  | "credit_limit_charges"
  | "indemnity"
  | "excess"
  | "excess_type"
  | "max_annual_liability"
  | "discretionary_limit"
  | "max_terms_of_payment"
  | "max_extension_period"
  | "additional_info";

export type QuoteExtraction = Record<ExtractedFieldKey, SourcedValue> & {
  document_type: DocumentType;
  buyer_credit_limits: BuyerCreditLimit[];
};

export interface SetField {
  value: string;
  source: "insurer_rule";
  matched_insurer: string | null;
}

export interface SetFields {
  debt_collection_support: SetField;
}

export interface ProcessingMeta {
  filename: string;
  page_count: number;
  document_id: string | null;
  extraction_engine: "docling" | "pymupdf" | "azure_document_intelligence" | (string & {});
  llm_model: string;
}

export interface ReviewSummary {
  missing_fields: string[];
  uncertain_fields: string[];
  unverified_fields: string[];
  confirm_required: string[];
}

export interface ExtractionResponse {
  meta: ProcessingMeta;
  review: ReviewSummary;
  set_fields: SetFields;
  data: QuoteExtraction;
}

// ── Background extraction jobs (POST /extract-jobs, GET /extract-jobs/{id}) ──
export type ExtractJobStatus = "queued" | "processing" | "done" | "error";

export interface ExtractJob {
  job_id: string;
  status: ExtractJobStatus;
  /** queued | extracting | done | failed */
  stage: string;
  filename: string;
  kind: DocKind | string;
  project_id: string | null;
  created: number;
  updated: number;
  result: ExtractionResponse | null;
  error: string | null;
  error_status: number | null;
}

// ── Presentation export (POST /generate-presentation) ───────────────────
export type ExportFormat = "pptx" | "pdf" | "limits-xlsx";

export interface PresentationColumn {
  id: string;
  name: string;
  matched: string | null;
  values: Record<string, string>;
}

export interface CreditLimitRow {
  buyer: string;
  company_number: string;
  required: string;
  offers: Record<string, string>;
}

export interface PresentationRequest {
  client_name: string;
  reference: string;
  project_type: "new" | "renewal";
  columns: PresentationColumn[];
  recommended_id: string | null;
  approached_insurers: string[];
  credit_limits: CreditLimitRow[];
  notes: string;
  reasons: string;
  confirmed_fields: string[];
}

/** Edit-rate / preparation-time metrics (BRD section 5) sent as query params. */
export interface PresentationStats {
  fieldsTotal: number;
  fieldsEdited: number;
  prepSeconds?: number;
}

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

// ── Observability ───────────────────────────────────────────────────────
export interface HealthResponse {
  status: "ok";
  llm: string;
  openai_configured: boolean;
  anthropic_configured: boolean;
  azure_configured: boolean;
  docling_installed: boolean;
  scanned_pdf_engine: "azure" | "docling" | "none";
}

export interface ClientErrorReport {
  message: string;
  kind?: string;
  where?: string;
  stack?: string;
}
