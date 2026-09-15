/**
 * Base API client: a thin `fetch` wrapper that knows the backend's
 * conventions (Bearer access token from Supabase Auth, the `{ detail }`
 * error envelope) and turns failures into a typed ApiError.
 *
 * Endpoint functions live in ./endpoints.ts; UI code should import those
 * rather than calling `request()` directly.
 */
import { env } from "@/lib/env";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue = string | number | boolean | string[] | null | undefined;

export interface RequestOptions {
  method?: HttpMethod;
  /** JSON body. Ignored when `formData` is given. */
  body?: unknown;
  /** Multipart body (file uploads). Sent as-is; the browser sets Content-Type. */
  formData?: FormData;
  /** Query-string parameters; null/undefined entries are dropped. */
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Abort after this many milliseconds. Default 60s; uploads pass more. */
  timeoutMs?: number;
  /**
   * When false, a 401/403 is returned as a plain ApiError instead of being
   * treated as an expired session.
   */
  sessionBound?: boolean;
  /** When false, no Authorization header is attached (public endpoints). */
  auth?: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  /** Human-readable detail from the backend's `{ detail }` envelope. */
  readonly detail: string;
  /** Seconds to wait, from a 429 `Retry-After` header. */
  readonly retryAfter: number | null;

  constructor(status: number, detail: string, retryAfter: number | null = null) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.retryAfter = retryAfter;
  }

  get isUnauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Thrown when the request was aborted by its timeout (not by the caller). */
export class ApiTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "ApiTimeoutError";
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;

// ── Access token source ─────────────────────────────────────────────────
// The session provider registers a function returning the current Supabase
// access token (refreshed automatically by supabase-js). Keeping it behind
// a provider means this module has no dependency on the auth library.
type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider | null = null;

export function setAuthTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

// ── Session-expired hook ────────────────────────────────────────────────
type UnauthorizedHandler = (error: ApiError) => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Register the single app-level handler (the session provider does this). */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

// ── Helpers ─────────────────────────────────────────────────────────────
export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const search = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) search.append(key, String(v));   // ?status=a&status=b
      } else {
        search.set(key, String(value));
      }
    }
  }
  const qs = search.toString();
  return `${env.apiBaseUrl}${cleanPath}${qs ? `?${qs}` : ""}`;
}

/** Normalise FastAPI's `detail` (a string, or a list of validation errors). */
export function extractDetail(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const { loc, msg } = item as { loc?: unknown[]; msg?: string };
        const where = Array.isArray(loc) ? loc.filter((l) => l !== "body").join(".") : "";
        return where && msg ? `${where}: ${msg}` : (msg ?? null);
      })
      .filter(Boolean);
    if (messages.length) return messages.join("; ");
  }
  return fallback;
}

export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : fallback;
}

async function toApiError(response: Response): Promise<ApiError> {
  const fallback = `HTTP ${response.status}`;
  let detail = fallback;
  try {
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      detail = extractDetail(await response.json(), fallback);
    } else {
      const text = (await response.text()).trim();
      if (text && text.length < 300) detail = text;
    }
  } catch {
    /* keep fallback */
  }
  const retryHeader = response.headers.get("retry-after");
  const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : null;
  return new ApiError(response.status, detail, retryAfter);
}

// ── Core request ────────────────────────────────────────────────────────
/**
 * Perform a request and return the raw `Response` (already checked for
 * `ok`). Prefer the typed helpers below.
 */
export async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const method: HttpMethod =
    options.method ?? (options.body !== undefined || options.formData ? "POST" : "GET");
  const headers: Record<string, string> = { Accept: "application/json, */*", ...options.headers };

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  if (options.auth !== false && tokenProvider) {
    const token = await tokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  // The caller may have given up while the token was being read.
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ApiTimeoutError(timeoutMs)), timeoutMs);
  const onCallerAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    if (controller.signal.reason instanceof ApiTimeoutError) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }

  if (response.ok) return response;

  const apiError = await toApiError(response);
  if (apiError.isUnauthorized && options.sessionBound !== false) {
    unauthorizedHandler?.(apiError);
  }
  throw apiError;
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface BlobResult {
  blob: Blob;
  filename: string | null;
  contentType: string | null;
  headers: Headers;
}

export async function requestBlob(path: string, options: RequestOptions = {}): Promise<BlobResult> {
  const response = await request(path, options);
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("content-disposition"), "") || null,
    contentType: response.headers.get("content-type"),
    headers: response.headers,
  };
}

type Opts = Omit<RequestOptions, "method" | "body">;

export const http = {
  get: <T>(path: string, options: Omit<Opts, "formData"> = {}) =>
    requestJson<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options: Opts = {}) =>
    requestJson<T>(path, { ...options, method: "POST", body }),
  put: <T>(path: string, body?: unknown, options: Opts = {}) =>
    requestJson<T>(path, { ...options, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, options: Opts = {}) =>
    requestJson<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options: Opts = {}) =>
    requestJson<T>(path, { ...options, method: "DELETE" }),
};

/** A user-facing message for any thrown value. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof ApiTimeoutError) return error.message;
  if (error instanceof DOMException && error.name === "AbortError") return "Request cancelled";
  if (error instanceof TypeError) return "Network error. Check your connection and try again.";
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
