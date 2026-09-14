"""Generate the PDF/Excel fixtures the E2E suite uploads.

The committed fixtures next to this script are what CI uses — this script
only needs re-running when a fixture's content changes:

    python e2e/fixtures/generate_fixtures.py

Each quote PDF carries the marker lines the deterministic extractor
(LLM_PROVIDER=stub) reads (see backend/app/llm/stub_extractor.py). Because
the values are also the visible document text, the normal verification pass
confirms them, so the stub drives the pipeline exactly like a real quote.
"""

from pathlib import Path

import pymupdf

HERE = Path(__file__).resolve().parent


def _pdf(lines: list[str]) -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    for i, line in enumerate(lines):
        page.insert_text((72, 90 + i * 22), line, fontsize=11)
    data = doc.tobytes()
    doc.close()
    return data


def _quote(insurer: str, *, premium: str, indemnity: str, excess: str,
           max_liability: str, rate: str) -> list[str]:
    return [
        f"INSURER: {insurer}",
        "DOCTYPE: insurer_quote",
        "Turnover: GBP 12,000,000",
        f"Premium Rate: {rate}",
        f"Estimated Annual Premium: {premium}",
        "Minimum Annual Premium: GBP 5,000",
        "Credit Limit Charges: GBP 45 per decision",
        f"Indemnity: {indemnity}",
        f"Excess: {excess}",
        "Excess Type: Minimum Retention",
        f"Max Annual Liability: {max_liability}",
        "Discretionary Limit: GBP 20,000",
        "Max Terms of Payment: 90 days",
        "Max Extension Period: 60 days",
        "Additional Info: Subject to underwriting and policy terms.",
    ]


FIXTURES: dict[str, bytes] = {
    # Three distinct insurers -> three distinct comparison columns.
    "quote-allianz.pdf": _pdf(_quote(
        "Allianz Trade", premium="GBP 14,400", indemnity="90%",
        excess="GBP 1,000", max_liability="GBP 2,000,000", rate="0.32%")),
    "quote-atradius.pdf": _pdf(_quote(
        "Atradius", premium="GBP 12,600", indemnity="90%",
        excess="GBP 2,500", max_liability="GBP 1,800,000", rate="0.28%")),
    # The "late quote" for the cumulative-upload flow.
    "quote-coface.pdf": _pdf(_quote(
        "Coface", premium="GBP 13,200", indemnity="85%",
        excess="GBP 1,500", max_liability="GBP 1,500,000", rate="0.30%")),
    # A renewal's expiring policy (uploaded via the expiring slot).
    "expiring-allianz.pdf": _pdf([
        "INSURER: Allianz Trade",
        "DOCTYPE: policy_document",
        "Turnover: GBP 11,000,000",
        "Premium Rate: 0.35%",
        "Estimated Annual Premium: GBP 15,800",
        "Indemnity: 90%",
        "Excess: GBP 1,000",
        "Excess Type: Minimum Retention",
        "Max Annual Liability: GBP 2,000,000",
    ]),
    # A standalone credit-limit schedule for Allianz Trade.
    "limits-allianz.pdf": _pdf([
        "INSURER: Allianz Trade",
        "DOCTYPE: credit_limit_schedule",
        "BUYER: Meridian Foods Ltd | 04821990 | GBP 250,000 | GBP 200,000",
        "BUYER: Northwind Traders Ltd | 07654321 | GBP 100,000 | GBP 80,000",
    ]),
}


def main() -> None:
    for name, data in FIXTURES.items():
        (HERE / name).write_bytes(data)
        print(f"wrote {name} ({len(data):,} bytes)")


if __name__ == "__main__":
    main()
