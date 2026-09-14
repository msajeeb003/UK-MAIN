"""
Deterministic, offline extraction — no LLM, no network, no API keys.

Enabled with LLM_PROVIDER=stub. It reads the same page-tagged text the real
providers receive and returns a `QuoteExtraction` built from explicit marker
lines in the document:

    INSURER: Allianz Trade
    DOCTYPE: insurer_quote            (or credit_limit_schedule)
    Estimated Annual Premium: GBP 14,400
    Indemnity: 90%
    BUYER: Meridian Foods Ltd | 04821990 | GBP 250,000 | GBP 200,000

Because every value is taken verbatim from the document text, the normal
verification pass confirms it and keeps its confidence 'high' — so the stub
exercises the whole pipeline exactly as a real extraction would.

Two uses: reproducible browser E2E tests (see e2e/) and a keyless local demo.
It is refused in production (see app.core.startup).
"""

import re

from app.models.schemas import (
    BuyerCreditLimit,
    DocumentType,
    QuoteExtraction,
    SourcedValue,
)

# Longest labels first so "excess type" wins over "excess", and
# "minimum annual premium" over the premium field.
_FIELD_LABELS: list[tuple[str, str]] = [
    ("annual turnover", "annual_turnover"),
    ("turnover", "annual_turnover"),
    ("premium rate", "premium_rate"),
    ("estimated annual premium", "estimated_annual_premium_exc_ipt"),
    ("minimum annual premium", "minimum_annual_premium"),
    ("credit limit charges", "credit_limit_charges"),
    ("indemnity", "indemnity"),
    ("excess type", "excess_type"),
    ("excess", "excess"),
    ("maximum annual liability", "max_annual_liability"),
    ("max annual liability", "max_annual_liability"),
    ("discretionary limit", "discretionary_limit"),
    ("max terms of payment", "max_terms_of_payment"),
    ("max extension period", "max_extension_period"),
    ("additional info", "additional_info"),
]

_PAGE_MARKER = re.compile(r"^=== PAGE (\d+) ===$")


def _blank_extraction() -> dict[str, SourcedValue]:
    return {
        name: SourcedValue(value=None, page=None, confidence=None)
        for name in QuoteExtraction.model_fields
        if name not in ("document_type", "buyer_credit_limits")
    }


def _match_label(lower_key: str) -> str | None:
    for label, field in _FIELD_LABELS:
        if lower_key == label or lower_key.startswith(label):
            return field
    return None


def extract_stub(tagged_document_text: str) -> QuoteExtraction:
    """Parse marker lines into a QuoteExtraction. Never raises on odd input —
    unrecognised lines are ignored and unset fields stay null (BRD 2.2)."""
    fields = _blank_extraction()
    buyers: list[BuyerCreditLimit] = []
    document_type: DocumentType = "insurer_quote"
    page = 1

    for raw in tagged_document_text.splitlines():
        line = raw.strip()
        if not line:
            continue
        marker = _PAGE_MARKER.match(line)
        if marker:
            page = int(marker.group(1))
            continue

        key, sep, value = line.partition(":")
        if not sep:
            continue
        key_lower = key.strip().lower()
        value = value.strip()

        if key_lower == "doctype" or key_lower == "document type":
            if value in DocumentType.__args__:  # type: ignore[attr-defined]
                document_type = value  # type: ignore[assignment]
            continue
        if key_lower == "insurer":
            fields["insurer"] = SourcedValue(value=value, page=page, confidence="high")
            continue
        if key_lower == "buyer":
            # name | company_number | required | offered  (trailing parts optional)
            parts = [p.strip() or None for p in value.split("|")]
            parts += [None] * (4 - len(parts))
            buyers.append(BuyerCreditLimit(
                buyer_name=parts[0], company_number=parts[1],
                limit_required=parts[2], limit_offered=parts[3], page=page,
            ))
            continue

        field = _match_label(key_lower)
        if field and value:
            fields[field] = SourcedValue(value=value, page=page, confidence="high")

    return QuoteExtraction(
        document_type=document_type,
        buyer_credit_limits=buyers,
        **fields,
    )
