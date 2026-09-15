/**
 * Render-time money formatting (Feedback Round 1, B2 / B4) — the web
 * mirror of backend/app/services/money.py, so what the broker sees on S5,
 * S6 and the S8 preview is what the deck prints.
 *
 * The stored value (and its source-page link) is never rewritten: cells
 * show the formatted text while idle and the raw text while being edited.
 * Blank stays blank — never "£0" for a missing value. A value that is not
 * a plain figure ("Fixed", "Included", "£45 per limit", "Nil") is left
 * verbatim: nothing is inferred.
 */

const PLAIN_MONEY = /^\s*(?:£|gbp)?\s*(\d[\d,]*)(?:\.(\d+))?\s*$/i;
const MONEY_IN_TEXT = /(?:£|gbp)\s*(\d[\d,]*)(?:\.(\d+))?/i;
const LIMIT_COUNT = /\b(\d{1,4})\s+(?:(?:active|approved|agreed|credit|buyer|new)\s+)?limits?\b/i;
const PER_LIMIT = /\b(?:per|each|every|a)\s+(?:credit\s+)?limit\b/i;
// A bare figure that opens the text is the amount unless it is itself the limit count.
const LEADING_AMOUNT = /^\s*(\d[\d,]*)\b(?:\.(\d+))?(?!\s*(?:(?:active|approved|agreed|credit|buyer|new)\s+)?limits?\b)/i;

/** BRD 2.3 rows that hold a money amount. Premium rate is a percentage. */
export const MONEY_FIELDS: ReadonlySet<string> = new Set([
  "annual_turnover",
  "estimated_annual_premium_exc_ipt",
  "minimum_annual_premium",
  "excess",
  "max_annual_liability",
  "discretionary_limit",
]);
export const CHARGES_FIELD = "credit_limit_charges";

function pounds(whole: string, fraction: string | undefined): string {
  const n = Number(whole.replace(/,/g, "") || "0");
  let out = `£${n.toLocaleString("en-GB")}`;
  if (fraction && fraction.replace(/0/g, "") !== "") out += "." + (fraction + "00").slice(0, 2);
  return out;
}

/** "GBP 250,000" / "250000" / "£250,000.00" → "£250,000"; "" → ""; wording → unchanged. */
export function formatMoney(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  const m = text.match(PLAIN_MONEY);
  if (!m) return text;
  return pounds(m[1], m[2]);
}

/** Credit-limit charges (B4): "£350" or "£350 / 25 limits" when the document states a count. */
export function formatCharges(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  if (PLAIN_MONEY.test(text)) return formatMoney(text);
  if (PER_LIMIT.test(text)) return text;
  const m = text.match(LEADING_AMOUNT) ?? text.match(MONEY_IN_TEXT);
  if (!m) return text;
  const amount = pounds(m[1], m[2]);
  const count = text.match(LIMIT_COUNT);
  if (!count) return amount;
  const n = Number(count[1]);
  return `${amount} / ${n} limit${n === 1 ? "" : "s"}`;
}

/** The text a row's cell shows for one field on the deck and on screen while idle. */
export function renderValue(fieldKey: string, value: string | null | undefined): string {
  if (fieldKey === CHARGES_FIELD) return formatCharges(value);
  if (MONEY_FIELDS.has(fieldKey)) return formatMoney(value);
  return (value ?? "").trim();
}

/** True for rows whose idle display goes through the formatter. */
export function isMoneyField(fieldKey: string): boolean {
  return fieldKey === CHARGES_FIELD || MONEY_FIELDS.has(fieldKey);
}
