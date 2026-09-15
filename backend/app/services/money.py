"""
Render-time money formatting (Feedback Round 1, B2 / B4).

Extracted values are stored exactly as the document states them ("GBP
55,000", "£250,000", "250,000") and keep their source-page link; only the
GENERATED output (deck, standalone exports, on-screen display) is
normalised, through this one formatter, to "£" + thousands separators —
never the string "GBP", never a bare figure.

Blank stays blank (BRD 2.5: a blank is distinguishable from zero) — the
formatter never produces "£0" for a missing value. A value that is not a
plain figure ("Fixed", "Included", "£45 per limit", "Nil") is left
verbatim: nothing is inferred (BRD rule "Blank, never guessed").
"""

import re

# One plain figure, optionally prefixed with £ or GBP: "GBP 55,000", "£1,000.50", "250000".
_PLAIN_MONEY = re.compile(r"^\s*(?:£|gbp)?\s*(\d[\d,]*)(?:\.(\d+))?\s*$", re.I)
# A currency-marked figure inside longer text.
_MONEY_IN_TEXT = re.compile(r"(?:£|gbp)\s*(\d[\d,]*)(?:\.(\d+))?", re.I)
# "44 Active Limits", "30 Credit Limits", "25 limits" — an expressly stated count.
_LIMIT_COUNT = re.compile(
    r"\b(\d{1,4})\s+(?:(?:active|approved|agreed|credit|buyer|new)\s+)?limits?\b", re.I,
)
# A rate per limit ("£45 per limit") is not a fixed charge — kept verbatim.
_PER_LIMIT = re.compile(r"\b(?:per|each|every|a)\s+(?:credit\s+)?limit\b", re.I)

# BRD 2.3 rows that hold a money amount (B2). Credit-limit charges have
# their own rule (B4). Premium rate is a percentage and is not touched.
MONEY_FIELDS = frozenset({
    "annual_turnover", "estimated_annual_premium_exc_ipt", "minimum_annual_premium",
    "excess", "max_annual_liability", "discretionary_limit",
})
CHARGES_FIELD = "credit_limit_charges"


def _pounds(whole: str, fraction: str | None) -> str:
    amount = f"£{int(whole.replace(',', '') or 0):,}"
    if fraction and fraction.strip("0"):
        amount += "." + (fraction + "00")[:2]      # pence kept when non-zero
    return amount


def format_money(value: str | None) -> str:
    """"GBP 250,000" / "250000" / "£250,000.00" -> "£250,000"; "" -> "";
    anything that is not a plain figure -> unchanged."""
    text = (value or "").strip()
    if not text:
        return ""
    m = _PLAIN_MONEY.match(text)
    if not m:
        return text
    return _pounds(m.group(1), m.group(2))


def format_charges(value: str | None) -> str:
    """Credit-limit charges (B4): the amount in £, plus "/ N limits" only when
    the document expressly states a number of limits. No amount stated, or
    a per-limit rate -> the text is kept verbatim."""
    text = (value or "").strip()
    if not text:
        return ""
    if _PLAIN_MONEY.match(text):
        return format_money(text)
    if _PER_LIMIT.search(text):
        return text
    m = _MONEY_IN_TEXT.search(text)
    if not m:
        return text
    amount = _pounds(m.group(1), m.group(2))
    count = _LIMIT_COUNT.search(text)
    if not count:
        return amount
    n = int(count.group(1))
    return f"{amount} / {n} limit{'' if n == 1 else 's'}"


_ZERO_WORDS = re.compile(r"^(?:nil|none|declined|zero)$", re.I)


def amount_of(value: str | None) -> int | None:
    """The figure a plain money value states, in whole pounds ("Nil" and
    "Declined" count as 0 — an explicit zero); None for blank or wording."""
    text = (value or "").strip()
    if not text:
        return None
    if _ZERO_WORDS.match(text):
        return 0
    m = _PLAIN_MONEY.match(text)
    if not m:
        return None
    return round(float(m.group(1).replace(",", "") + "." + (m.group(2) or "0")))


def sort_limit_rows(rows: list, required_of) -> list:
    """Buyer rows largest limit required first (Feedback Round 1, D2);
    rows without a limit required keep their order at the bottom."""
    def key(item):
        amount = amount_of(required_of(item[1]))
        return (0, -amount, item[0]) if amount is not None else (1, 0, item[0])
    return [row for _, row in sorted(enumerate(rows), key=key)]


def render_value(field_key: str, value: str | None) -> str:
    """The text a row's cell shows on the deck / exports for one field."""
    if field_key == CHARGES_FIELD:
        return format_charges(value)
    if field_key in MONEY_FIELDS:
        return format_money(value)
    return (value or "").strip()
