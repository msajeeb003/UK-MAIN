"""
Pipeline orchestrator: document bytes -> page-tagged text -> LLM ->
sanitized, verified, rule-annotated `ExtractionResponse` (BRD 2.2).

Routing: .pdf -> PyMuPDF, or OCR when scanned (Azure if configured, else
Docling); .xlsx/.xls -> worksheet extractor. FastAPI-free so it can be
unit-tested or reused by a batch worker.
"""

import asyncio
import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Literal

from app.core.config import get_settings
from app.core.errors import InvalidDocumentError
from app.extraction.azure_extractor import extract_pages_azure
from app.extraction.base import PageText, to_tagged_document
from app.extraction.detector import PdfKind, classify_pdf, open_pdf
from app.extraction.docling_extractor import extract_pages_docling
from app.extraction.excel_extractor import extract_pages_excel
from app.extraction.pymupdf_extractor import extract_pages_pymupdf
from app.llm.router import active_model_label, extract_quote_fields
from app.models.schemas import (
    ExtractionResponse,
    ProcessingMeta,
    QuoteExtraction,
    ReviewSummary,
    SetField,
    SetFields,
    StepTiming,
    sourced_items,
)
from app.services.library import debt_collection_rule, get_terminology
from app.services.verification import verify_extraction

logger = logging.getLogger(__name__)

EngineOverride = Literal["auto", "digital", "azure", "docling"]
FileKind = Literal["pdf", "excel"]


def _sanitize(extraction: QuoteExtraction, page_count: int) -> QuoteExtraction:
    """
    Defensive pass over the LLM output: out-of-range page cites cleared
    (values kept), null values carry no page/confidence, unflagged values
    default to 'high'. Keeps source links and review flags trustworthy.
    """
    for field_name, item in sourced_items(extraction):
        if item.value is None:
            item.page = None
            item.confidence = None
            continue
        if item.page is not None and not (1 <= item.page <= page_count):
            logger.warning("Field %r cited out-of-range page %s — clearing link",
                           field_name, item.page)
            item.page = None
        if item.confidence is None:
            item.confidence = "high"

    for row in extraction.buyer_credit_limits:
        if row.page is not None and not (1 <= row.page <= page_count):
            row.page = None

    return extraction


def _build_review(extraction: QuoteExtraction, unverified: list[str]) -> ReviewSummary:
    """Deterministic review summary — computed server-side, never by the LLM."""
    return ReviewSummary(
        missing_fields=[n for n, i in sourced_items(extraction) if i.value is None],
        uncertain_fields=[n for n, i in sourced_items(extraction)
                          if i.confidence == "uncertain"],
        unverified_fields=unverified,
    )


def _build_set_fields(extraction: QuoteExtraction) -> SetFields:
    """BRD 2.4: debt collection support is SET by the insurer rule
    (backend/config/insurers.json), never extracted."""
    value, matched = debt_collection_rule(extraction.insurer.value)
    return SetFields(
        debt_collection_support=SetField(
            value=value, source="insurer_rule", matched_insurer=matched,
        )
    )


def _scanned_engine(override: EngineOverride) -> str:
    """Scanned routing: explicit override wins; else Azure when configured,
    else the open-source Docling engine."""
    if override in ("azure", "docling"):
        return override
    settings = get_settings()
    if settings.azure_endpoint and settings.azure_key.get_secret_value():
        return "azure"
    return "docling"


async def _extract_pdf_pages(
    pdf_bytes: bytes, engine: EngineOverride
) -> tuple[list[PageText], int, str]:
    doc = open_pdf(pdf_bytes)
    try:
        page_count = doc.page_count
        if engine == "auto":
            scanned = classify_pdf(doc) is PdfKind.SCANNED
        else:
            scanned = engine in ("azure", "docling")

        if not scanned:
            return extract_pages_pymupdf(doc), page_count, "pymupdf"
    finally:
        doc.close()

    # Blocking OCR calls -> worker thread keeps the event loop free.
    if _scanned_engine(engine) == "azure":
        pages = await asyncio.to_thread(extract_pages_azure, pdf_bytes)
        return pages, page_count, "azure_document_intelligence"
    pages = await asyncio.to_thread(extract_pages_docling, pdf_bytes)
    return pages, page_count, "docling"


class StepRecorder:
    """Collects one StepTiming per pipeline step (accuracy work, ART-330).
    Pass one into `run_extraction_pipeline`; on failure it still holds the
    steps completed before the error."""

    def __init__(self) -> None:
        self.steps: list[StepTiming] = []

    @contextmanager
    def step(self, name: str) -> Iterator[dict]:
        info: dict = {}
        started = time.monotonic()
        ok = True
        try:
            yield info
        except BaseException as exc:
            ok = False
            info.setdefault("error", type(exc).__name__)
            raise
        finally:
            self.steps.append(StepTiming(
                step=name, ms=int((time.monotonic() - started) * 1000), ok=ok,
                detail=", ".join(f"{k}={v}" for k, v in info.items()),
            ))
            logger.info("pipeline step", extra={"extra_fields": {
                "event": "pipeline_step", "step": name, "ok": ok,
                "duration_ms": self.steps[-1].ms, **{k: str(v) for k, v in info.items()},
            }})


async def run_extraction_pipeline(
    file_bytes: bytes,
    filename: str,
    engine: EngineOverride = "auto",
    file_kind: FileKind = "pdf",
    steps: StepRecorder | None = None,
) -> ExtractionResponse:
    """Full extraction flow for one uploaded document, in order:
    text extraction (digital, fallback OCR) → identification + field /
    limit extraction (one structured model call over the mapping library)
    → insurer matching → terminology bookkeeping → verification. Raises
    `PipelineError` subclasses; the API layer maps them to HTTP."""
    rec = steps or StepRecorder()

    with rec.step("text_extraction") as info:
        if file_kind == "excel":
            pages = await asyncio.to_thread(extract_pages_excel, file_bytes)
            page_count, engine_used = len(pages), "excel"
        else:
            pages, page_count, engine_used = await _extract_pdf_pages(file_bytes, engine)
        info["engine"] = engine_used
        info["pages"] = page_count
        info["chars"] = sum(len(page.text) for page in pages)
        if not any(page.text.strip() for page in pages):
            raise InvalidDocumentError(
                f"No text could be extracted from this document with the "
                f"'{engine_used}' engine."
            )

    with rec.step("extraction") as info:
        # Document type, insurer and every field / buyer limit come from one
        # structured call; the terminology map is part of its prompt.
        extraction = await asyncio.to_thread(
            extract_quote_fields, to_tagged_document(pages)
        )
        info["model"] = active_model_label()
        info["doc_type"] = extraction.document_type
        info["insurer"] = extraction.insurer.value or "-"
        info["buyers"] = len(extraction.buyer_credit_limits)

    with rec.step("identification") as info:
        extraction = _sanitize(extraction, page_count)
        set_fields = _build_set_fields(extraction)
        matched = set_fields.debt_collection_support.matched_insurer
        info["matched"] = matched or "-"
        if extraction.document_type == "insurer_quote" and not (extraction.insurer.value or "").strip():
            raise InvalidDocumentError(
                "No insurer could be identified in this document, so it cannot "
                "be placed as a quote column."
            )

    with rec.step("terminology_mapping") as info:
        # Applied inside the model prompt (app/llm/prompt.py); recorded here
        # so a run can be tied to the mapping library it used.
        terms = get_terminology()
        info["fields"] = len(terms)
        info["terms"] = sum(len(v) for v in terms.values())

    with rec.step("verification") as info:
        unverified = verify_extraction(extraction, pages)
        info["unverified"] = len(unverified)

    return ExtractionResponse(
        meta=ProcessingMeta(
            filename=filename,
            page_count=page_count,
            extraction_engine=engine_used,
            llm_model=active_model_label(),
            steps=list(rec.steps),
        ),
        review=_build_review(extraction, unverified),
        set_fields=set_fields,
        data=extraction,
    )
