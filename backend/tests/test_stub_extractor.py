"""The deterministic offline extractor (LLM_PROVIDER=stub).

Used by the browser E2E suite and keyless local demos; it must produce a
valid QuoteExtraction from the document's marker lines and drive the real
pipeline (verification keeps the values, since they are the document text)."""

from app.llm.stub_extractor import extract_stub
from tests.conftest import make_pdf

QUOTE_MARKERS = [
    "=== PAGE 1 ===",
    "INSURER: Allianz Trade",
    "DOCTYPE: insurer_quote",
    "Estimated Annual Premium: GBP 14,400",
    "Indemnity: 90%",
    "Excess Type: Minimum Retention",
    "Excess: GBP 1,000",
    "Max Annual Liability: GBP 2,000,000",
]


def test_parses_quote_markers_into_sourced_values():
    result = extract_stub("\n".join(QUOTE_MARKERS))
    assert result.document_type == "insurer_quote"
    assert result.insurer.value == "Allianz Trade"
    assert result.estimated_annual_premium_exc_ipt.value == "GBP 14,400"
    assert result.indemnity.value == "90%"
    # Longest-label-first: "Excess Type" must not be captured as "Excess".
    assert result.excess_type.value == "Minimum Retention"
    assert result.excess.value == "GBP 1,000"
    assert result.max_annual_liability.value == "GBP 2,000,000"
    # Everything on page 1, confidence high, unset fields null (BRD 2.2).
    assert result.insurer.page == 1
    assert result.insurer.confidence == "high"
    assert result.minimum_annual_premium.value is None


def test_parses_credit_limit_schedule():
    text = "\n".join([
        "INSURER: Atradius",
        "DOCTYPE: credit_limit_schedule",
        "BUYER: Meridian Foods Ltd | 04821990 | GBP 250,000 | GBP 200,000",
        "BUYER: Northwind Traders Ltd | 07654321 | GBP 100,000 | GBP 80,000",
    ])
    result = extract_stub(text)
    assert result.document_type == "credit_limit_schedule"
    assert len(result.buyer_credit_limits) == 2
    first = result.buyer_credit_limits[0]
    assert first.buyer_name == "Meridian Foods Ltd"
    assert first.company_number == "04821990"
    assert first.limit_required == "GBP 250,000"
    assert first.limit_offered == "GBP 200,000"


def test_ignores_unrecognised_lines_and_never_raises():
    result = extract_stub("garbage without a colon\nRandom Heading: value\n")
    assert result.document_type == "insurer_quote"
    assert result.insurer.value is None


def test_stub_drives_the_pipeline_end_to_end(client, monkeypatch):
    """With LLM_PROVIDER=stub the whole /extract-quote path runs keyless and
    the returned values verify against the document (confidence stays high)."""
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "llm_provider", "stub")
    monkeypatch.setattr(get_settings(), "openai_api_key",
                        type(get_settings().openai_api_key)(""))
    monkeypatch.setattr(get_settings(), "anthropic_api_key",
                        type(get_settings().anthropic_api_key)(""))
    # The stub reads markers from the document text; verification then
    # confirms them because they ARE the text.
    pdf = make_pdf([[line for line in QUOTE_MARKERS if not line.startswith("===")]])
    res = client.post(
        "/extract-quote",
        files={"file": ("quote.pdf", pdf, "application/pdf")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["meta"]["llm_model"] == "stub:deterministic"
    assert body["data"]["insurer"]["value"] == "Allianz Trade"
    assert body["data"]["indemnity"] == {"value": "90%", "page": 1, "confidence": "high"}
    assert body["review"]["unverified_fields"] == []


def test_router_dispatches_stub(monkeypatch):
    from app.core.config import get_settings
    from app.llm import router
    monkeypatch.setattr(get_settings(), "llm_provider", "stub")
    assert router.resolve_provider() == "stub"
    assert router.active_model_label() == "stub:deterministic"
    out = router.extract_quote_fields("INSURER: Coface\n")
    assert out.insurer.value == "Coface"
