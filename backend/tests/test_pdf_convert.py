"""PPTX → PDF conversion (PRD: server-side converter, LibreOffice headless).

LibreOffice itself is not a test dependency: the process is faked through
`subprocess.run`, and one real conversion runs only where `soffice` exists.
"""

import io
import shutil
import subprocess

import pymupdf
import pytest
from pptx import Presentation

from app.core.config import get_settings
from app.core.errors import ConfigurationError
from app.services import pdf_convert
from app.services.presentation import build_pptx
from tests.test_presentation import make_request


def _fake_soffice(monkeypatch, *, returncode=0, write_pdf=True, timeout=False):
    """Pretend `soffice` exists and behaves as told."""
    monkeypatch.setattr(pdf_convert.shutil, "which", lambda name: f"/usr/bin/{name}")
    calls: list[list[str]] = []

    def run(command, **kwargs):
        calls.append(command)
        if timeout:
            raise subprocess.TimeoutExpired(command, kwargs.get("timeout", 0))
        outdir = command[command.index("--outdir") + 1]
        if write_pdf:
            doc = pymupdf.open()
            doc.new_page().insert_text((72, 72), "converted")
            doc.new_page()
            doc.save(f"{outdir}/deck.pdf")
        return subprocess.CompletedProcess(command, returncode, b"", b"err")

    monkeypatch.setattr(pdf_convert.subprocess, "run", run)
    return calls


def test_pptx_to_pdf_runs_soffice_headless_and_returns_the_pdf(monkeypatch):
    calls = _fake_soffice(monkeypatch)
    pdf = pdf_convert.pptx_to_pdf(b"PK\x03\x04 not really a deck")
    assert pdf.startswith(b"%PDF")
    assert pymupdf.open(stream=pdf, filetype="pdf").page_count == 2
    command = calls[0]
    assert command[0].endswith("soffice")
    assert "--headless" in command and "--convert-to" in command
    assert command[command.index("--convert-to") + 1] == "pdf"
    assert any(arg.startswith("-env:UserInstallation=file:") for arg in command)
    assert command[-1].endswith("deck.pptx")


def test_conversion_failures_are_client_safe_502s(monkeypatch):
    _fake_soffice(monkeypatch, returncode=1, write_pdf=False)
    with pytest.raises(pdf_convert.ConversionError) as exc:
        pdf_convert.pptx_to_pdf(b"x")
    assert exc.value.status_code == 502
    assert "err" not in str(exc.value)          # stderr stays in the log

    _fake_soffice(monkeypatch, timeout=True)
    with pytest.raises(pdf_convert.ConversionError):
        pdf_convert.pptx_to_pdf(b"x")


def test_missing_binary_is_a_configuration_error(monkeypatch):
    monkeypatch.setattr(pdf_convert.shutil, "which", lambda name: None)
    with pytest.raises(ConfigurationError):
        pdf_convert.pptx_to_pdf(b"x")


def test_render_pdf_converts_the_pptx_when_libreoffice_is_present(monkeypatch):
    calls = _fake_soffice(monkeypatch)
    assert pdf_convert.converter_in_use() == "libreoffice"
    pdf = pdf_convert.render_pdf(make_request())
    assert pdf.startswith(b"%PDF") and calls


def test_render_pdf_falls_back_to_pymupdf_only_in_auto_mode(monkeypatch):
    monkeypatch.setattr(pdf_convert.shutil, "which", lambda name: None)
    settings = get_settings()

    monkeypatch.setattr(settings, "pdf_converter", "auto")
    assert pdf_convert.converter_in_use() == "pymupdf"
    pdf = pymupdf.open(stream=pdf_convert.render_pdf(make_request()), filetype="pdf")
    assert pdf.page_count >= 6                  # the same page sequence as the deck

    monkeypatch.setattr(settings, "pdf_converter", "libreoffice")
    assert pdf_convert.converter_in_use() == "libreoffice"
    with pytest.raises(ConfigurationError):
        pdf_convert.render_pdf(make_request())

    monkeypatch.setattr(settings, "pdf_converter", "pymupdf")
    assert pdf_convert.converter_in_use() == "pymupdf"


def test_export_gate_still_applies_before_conversion(monkeypatch):
    calls = _fake_soffice(monkeypatch)
    from app.core.errors import ExportBlockedError
    with pytest.raises(ExportBlockedError):
        pdf_convert.render_pdf(make_request(confirmed_fields=[]))
    assert not calls                             # nothing was converted


@pytest.mark.skipif(shutil.which("soffice") is None, reason="LibreOffice not installed")
def test_real_libreoffice_conversion_keeps_every_slide():
    deck = build_pptx(make_request())
    pdf = pdf_convert.pptx_to_pdf(deck)
    assert pymupdf.open(stream=pdf, filetype="pdf").page_count == len(
        Presentation(io.BytesIO(deck)).slides
    )
