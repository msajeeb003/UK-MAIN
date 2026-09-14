/**
 * Review-grid rows: the 16 standard term rows in terminology-sheet order.
 * `key` matches the backend JSON where a value is extracted; `set: true`
 * rows are broker- or rule-set and never extracted (BRD 2.4); `manual: true`
 * rows are broker-entered only (no extraction field exists for them).
 */
export interface FieldDef {
  key: string;
  label: string;
  note?: string;
  tag?: "SET" | "RULE";
  set?: boolean;
  /** Broker-entered only: the AI never extracts it (no backend field). */
  manual?: boolean;
  /** Confirm-before-export key (BRD 2.5). */
  confirm?: ConfirmKey;
}

export type ConfirmKey = "premium" | "indemnity" | "excess" | "maxLiability";

export const FIELDS: readonly FieldDef[] = [
  { key: "type", label: "Type of Policy", tag: "SET", note: "Set at setup · overridable per column", set: true },
  { key: "annual_turnover", label: "Insurable Turnover" },
  { key: "premium_rate", label: "Premium Rate" },
  { key: "estimated_annual_premium_exc_ipt", label: "Annual Premium", note: "Estimated · excl. IPT", confirm: "premium" },
  { key: "minimum_annual_premium", label: "Minimum Premium", note: "Excl. IPT" },
  { key: "credit_limit_charges", label: "Credit Limit Charges", note: "Excl. VAT" },
  { key: "debt", label: "Debt Collection", tag: "RULE", note: "Set by insurer rule", set: true },
  { key: "indemnity", label: "Indemnity", confirm: "indemnity" },
  { key: "excess", label: "Excess", confirm: "excess" },
  { key: "excess_type", label: "Excess Type", note: "Insurer's own term" },
  { key: "max_annual_liability", label: "Max Liability", note: "Annual", confirm: "maxLiability" },
  { key: "discretionary_limit", label: "Discretionary Limit" },
  { key: "max_terms_of_payment", label: "Max Terms of Payment" },
  { key: "max_extension_period", label: "Max Extension Period" },
  { key: "waiting_period", label: "Waiting Period", note: "Broker-entered", manual: true },
  { key: "additional_info", label: "Notes", note: "Free-format" },
];

/** Extracted (non-set, non-manual) field keys, in grid order. */
export const EXTRACTED_FIELD_KEYS: readonly string[] = FIELDS.filter((f) => !f.set && !f.manual).map((f) => f.key);

export const CONFIRM_FIELD_MAP: Record<ConfirmKey, string> = {
  premium: "estimated_annual_premium_exc_ipt",
  indemnity: "indemnity",
  excess: "excess",
  maxLiability: "max_annual_liability",
};

/** BRD 2.1: one to six quotes per project. */
export const MAX_QUOTES = 6;

export const DOC_TYPE_LABELS: Record<string, string> = {
  insurer_quote: "quote",
  credit_limit_schedule: "credit-limit schedule",
  policy_document: "policy document",
  other: "document",
};
