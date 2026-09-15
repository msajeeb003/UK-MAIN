"""Pipeline internals: text extraction shape and the source-link sanitizer."""

from app.extraction.base import TextBlock, build_ocr_pages, clean_text, to_tagged_document
from app.extraction.detector import open_pdf
from app.extraction.pymupdf_extractor import extract_pages_pymupdf
from app.services.pipeline import _build_review, _sanitize


def test_pymupdf_extraction_and_page_tags(digital_pdf):
    doc = open_pdf(digital_pdf)
    try:
        pages = extract_pages_pymupdf(doc)
    finally:
        doc.close()

    assert [p.page_number for p in pages] == [1, 2]
    assert "Insurable Turnover" in pages[0].text

    tagged = to_tagged_document(pages)
    assert "=== PAGE 1 ===" in tagged
    assert "=== PAGE 2 ===" in tagged
    # Page markers must precede their page's content.
    assert tagged.index("=== PAGE 1 ===") < tagged.index("Insurable Turnover")


def test_pymupdf_pages_carry_block_positions(digital_pdf):
    """PRD: PyMuPDF extracts text AND page positions — every block keeps its
    bounding box (PDF points) and the boxes read top-to-bottom."""
    doc = open_pdf(digital_pdf)
    try:
        page = extract_pages_pymupdf(doc)[0]
        height = doc[0].rect.height
    finally:
        doc.close()
    assert page.blocks and all(isinstance(b, TextBlock) for b in page.blocks)
    turnover = next(b for b in page.blocks if "Insurable Turnover" in b.text)
    assert 0 <= turnover.x0 < turnover.x1 and 0 <= turnover.y0 < turnover.y1 <= height
    assert [b.y0 for b in page.blocks] == sorted(b.y0 for b in page.blocks)
    assert "\n".join(b.text for b in page.blocks) == page.text


def test_ocr_pages_keep_line_positions_in_points():
    """The Azure engine feeds the same structure: line boxes are converted
    from inches to PDF points so both engines agree on units."""
    from app.extraction.azure_extractor import _line_block, _page_scale

    class Page:
        unit = "inch"

    class Line:
        content = "Indemnity 90%"
        polygon = [1.0, 2.0, 3.0, 2.0, 3.0, 2.25, 1.0, 2.25]

    block = _line_block(Line(), _page_scale(Page()))
    assert block == TextBlock(72.0, 144.0, 216.0, 162.0, "Indemnity 90%")
    assert _line_block(type("L", (), {"content": "x", "polygon": None})(), 72.0) is None

    pages = build_ocr_pages({1: ["Indemnity 90%"]}, {}, {1: [block]})
    assert pages[0].blocks == (block,)
    assert build_ocr_pages({1: ["a"]}, {})[0].blocks == ()   # engines without positions


def test_mojibake_text_layer_is_cleaned():
    # Seen in a real insurer PDF: a Latin-1-mangled text layer.
    assert clean_text("Annual Turnover: Â£3,750,000") == "Annual Turnover: £3,750,000"
    assert clean_text("the insurerâ€™s standard terms â€“ fixed") == "the insurer's standard terms – fixed"
    assert clean_text("plain £ text stays") == "plain £ text stays"


def test_sanitize_clears_bad_page_links(sample_extraction):
    out = _sanitize(sample_extraction, page_count=2)

    # A null value must not carry a page (or confidence).
    assert out.estimated_annual_premium_exc_ipt.page is None
    assert out.estimated_annual_premium_exc_ipt.confidence is None
    # An out-of-range citation loses the page but keeps the value.
    assert out.indemnity.value == "90%"
    assert out.indemnity.page is None
    # Valid citations are untouched.
    assert out.excess.page == 2
    assert out.insurer.page == 1
    # A non-null value with no confidence flag defaults to 'high'.
    assert out.excess.confidence == "high"
    # An explicit 'uncertain' flag survives sanitization.
    assert out.discretionary_limit.confidence == "uncertain"
    # Buyer rows get the same treatment.
    assert out.buyer_credit_limits[0].page is None
    assert out.buyer_credit_limits[0].limit_offered == "GBP 200,000"


def test_review_summary_lists_missing_and_uncertain(sample_extraction):
    out = _sanitize(sample_extraction, page_count=2)
    review = _build_review(out, unverified=[])

    assert "estimated_annual_premium_exc_ipt" in review.missing_fields
    assert "minimum_annual_premium" in review.missing_fields
    assert "insurer" not in review.missing_fields

    assert review.uncertain_fields == ["discretionary_limit"]
    # BRD 2.5 confirmation gate travels with every response.
    assert review.confirm_required == [
        "estimated_annual_premium_exc_ipt", "indemnity", "excess",
        "max_annual_liability",
    ]
