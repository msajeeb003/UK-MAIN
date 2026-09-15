"""
Scanned-PDF OCR via Azure AI Document Intelligence (prebuilt-layout).

Preferred scanned engine when AZURE_ENDPOINT / AZURE_KEY are configured;
also forceable with ?engine=azure for digital PDFs whose tables PyMuPDF
flattens badly.
"""

import logging
from collections import defaultdict
from functools import lru_cache

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential

from app.core.config import get_settings
from app.core.errors import ConfigurationError
from app.extraction.base import PageText, TextBlock, build_ocr_pages

logger = logging.getLogger(__name__)


@lru_cache
def _get_client() -> DocumentIntelligenceClient:
    settings = get_settings()
    if not settings.azure_endpoint or not settings.azure_key.get_secret_value():
        raise ConfigurationError(
            "Azure Document Intelligence is not configured — scanned PDFs "
            "cannot be processed. Set AZURE_ENDPOINT and AZURE_KEY."
        )
    return DocumentIntelligenceClient(
        endpoint=settings.azure_endpoint,
        credential=AzureKeyCredential(settings.azure_key.get_secret_value()),
    )


def _table_to_markdown(table) -> str:
    grid: list[list[str]] = [
        ["" for _ in range(table.column_count)] for _ in range(table.row_count)
    ]
    for cell in table.cells:
        content = (cell.content or "").replace("\n", " ").strip()
        if cell.row_index < table.row_count and cell.column_index < table.column_count:
            grid[cell.row_index][cell.column_index] = content

    lines = ["| " + " | ".join(row) + " |" for row in grid]
    if len(lines) > 1:
        lines.insert(1, "|" + "---|" * table.column_count)
    return "\n".join(lines)


def _page_scale(di_page) -> float:
    """Azure reports PDF pages in inches (images in pixels); positions are
    kept in PDF points to match the PyMuPDF engine."""
    return 72.0 if getattr(di_page, "unit", None) == "inch" else 1.0


def _line_block(line, scale: float) -> TextBlock | None:
    """A recognised line's bounding box (its polygon's extent) as a TextBlock."""
    polygon = list(getattr(line, "polygon", None) or [])
    if len(polygon) < 4:
        return None
    xs, ys = polygon[0::2], polygon[1::2]
    return TextBlock(
        round(min(xs) * scale, 1), round(min(ys) * scale, 1),
        round(max(xs) * scale, 1), round(max(ys) * scale, 1),
        (line.content or "").strip(),
    )


def extract_pages_azure(pdf_bytes: bytes) -> list[PageText]:
    """Blocking call (the poller waits for the Azure job) — the pipeline
    runs it in a worker thread."""
    client = _get_client()
    poller = client.begin_analyze_document(
        "prebuilt-layout", body=pdf_bytes, content_type="application/pdf",
    )
    result = poller.result()

    lines_by_page: dict[int, list[str]] = defaultdict(list)
    blocks_by_page: dict[int, list[TextBlock]] = defaultdict(list)
    for di_page in result.pages or []:
        scale = _page_scale(di_page)
        for line in di_page.lines or []:
            lines_by_page[di_page.page_number].append(line.content)
            block = _line_block(line, scale)
            if block is not None:
                blocks_by_page[di_page.page_number].append(block)

    tables_by_page: dict[int, list[str]] = defaultdict(list)
    for table in result.tables or []:
        if table.bounding_regions:
            page_no = table.bounding_regions[0].page_number
            tables_by_page[page_no].append(_table_to_markdown(table))

    pages = build_ocr_pages(lines_by_page, tables_by_page, blocks_by_page)
    logger.info("Azure DI extracted %d pages, %d tables",
                len(pages), len(result.tables or []))
    return pages
