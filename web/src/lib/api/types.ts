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

export interface ProjectsResponse {
  projects: ProjectState[];
}

export interface SaveProjectRequest {
  id: string;
  state: ProjectState;
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
