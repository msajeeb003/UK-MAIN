"""
Shared types for the text-extraction layer. Every extractor (PyMuPDF,
Azure, Docling, Excel) produces the same `list[PageText]`, so the LLM step
is engine-agnostic. Page numbers are 1-based, matching a PDF viewer.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TextBlock:
    """One positioned run of text. Coordinates are PDF points (72 per inch,
    origin top-left) for every engine, so a value can be located on the
    rendered page image whichever extractor produced it."""

    x0: float
    y0: float
    x1: float
    y1: float
    text: str


@dataclass(frozen=True)
class PageText:
    page_number: int  # 1-based
    text: str
    # Page-position data (PRD: "text and page positions"). Empty for engines
    # that have none to give (an Excel worksheet is not a page).
    blocks: tuple[TextBlock, ...] = ()


# Some PDFs carry a mojibake text layer (UTF-8 bytes decoded as Latin-1 by
# whatever produced the PDF) — seen in a real insurer indication during the
# pilot. Cleaning at extraction time keeps the LLM input, the verification
# pass, and the broker-facing values consistent.
_MOJIBAKE_MAP = {
    "Â£": "£", "Â·": "·", "Â°": "°", "Â®": "®",
    "â€™": "'", "â€˜": "'", "â€œ": '"', "â€\x9d": '"',
    "â€“": "–", "â€”": "—", "â€¦": "...", "Ã©": "é",
}


def clean_text(text: str) -> str:
    """Undo common mojibake sequences in an extracted text layer."""
    for bad, good in _MOJIBAKE_MAP.items():
        if bad in text:
            text = text.replace(bad, good)
    return text


def to_tagged_document(pages: list[PageText]) -> str:
    """
    Join page texts with explicit "=== PAGE n ===" markers — the LLM's only
    source of page numbers, which is what makes source-linking reliable.
    """
    parts = []
    for page in pages:
        parts.append(f"=== PAGE {page.page_number} ===")
        parts.append(page.text.strip())
    return "\n".join(parts)


def build_ocr_pages(
    lines_by_page: dict[int, list[str]],
    tables_by_page: dict[int, list[str]],
    blocks_by_page: dict[int, list[TextBlock]] | None = None,
) -> list[PageText]:
    """
    Assemble OCR output (recognized lines + rebuilt table grids, keyed by
    page number) into PageText — shared by the Azure and Docling engines.
    Tables are appended explicitly because a clean row/column grid is far
    more reliable for the LLM than the same cells scattered through lines.
    `blocks_by_page` carries the lines' page positions when the engine
    reports them.
    """
    pages: list[PageText] = []
    for page_no in sorted(set(lines_by_page) | set(tables_by_page)):
        sections = ["\n".join(lines_by_page.get(page_no, []))]
        for i, table_md in enumerate(tables_by_page.get(page_no, []), start=1):
            sections.append(f"[TABLE {i} ON THIS PAGE]\n{table_md}")
        pages.append(PageText(
            page_number=page_no,
            text=clean_text("\n\n".join(sections)),
            blocks=tuple((blocks_by_page or {}).get(page_no, [])),
        ))
    return pages
