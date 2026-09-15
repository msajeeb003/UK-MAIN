"""
PPTX → PDF conversion with LibreOffice headless (PRD stack: "PDF export —
server-side PPTX-to-PDF converter").

The PDF the broker downloads is produced from the very same PowerPoint
file, so the two never drift. LibreOffice runs as a short-lived headless
process per conversion with its own profile directory (no lock clashes
between gunicorn workers) and a hard timeout.

Fallback: when `soffice` is not installed and PDF_CONVERTER is "auto" (a
developer machine, the test suite), the built-in PyMuPDF renderer in
app/services/presentation.py draws the same page sequence directly. In
production the container image installs LibreOffice, and the start-up
check warns when it is missing.
"""

import logging
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from app.core.config import get_settings
from app.core.errors import ConfigurationError, UpstreamServiceError
from app.models.presentation import PresentationRequest
from app.services.presentation import build_pdf, build_pptx

logger = logging.getLogger(__name__)

# One LibreOffice process per worker at a time: a conversion takes a few
# seconds and a couple of hundred MB; parallel instances on a small host
# would only slow each other down.
_lock = threading.Lock()
_fallback_warned = False


class ConversionError(UpstreamServiceError):
    """LibreOffice did not produce a PDF (502 — the PowerPoint still downloads)."""


def soffice_binary() -> str | None:
    """Absolute path of the LibreOffice binary, or None when not installed."""
    return shutil.which(get_settings().soffice_path)


def soffice_available() -> bool:
    return soffice_binary() is not None


def converter_in_use() -> str:
    """Which renderer a PDF export would use right now: "libreoffice" | "pymupdf"."""
    mode = get_settings().pdf_converter
    if mode == "pymupdf":
        return "pymupdf"
    if mode == "libreoffice" or soffice_available():
        return "libreoffice"
    return "pymupdf"


def pptx_to_pdf(pptx_bytes: bytes) -> bytes:
    """Convert a PowerPoint file to PDF with `soffice --headless --convert-to pdf`.

    Blocking (a few seconds); the route runs it inside the request like the
    other builders. Raises ConfigurationError when LibreOffice is missing
    and ConversionError when it fails or times out.
    """
    binary = soffice_binary()
    if binary is None:
        raise ConfigurationError(
            "LibreOffice (soffice) is not installed on this server, so the PDF "
            "cannot be produced from the PowerPoint. Install libreoffice-impress "
            "or set PDF_CONVERTER=pymupdf."
        )
    settings = get_settings()
    with tempfile.TemporaryDirectory(prefix="deck-") as tmp:
        work = Path(tmp)
        source = work / "deck.pptx"
        source.write_bytes(pptx_bytes)
        profile = work / "profile"
        command = [
            binary, "--headless", "--norestore", "--nologo", "--nodefault",
            "--nolockcheck", f"-env:UserInstallation={profile.as_uri()}",
            "--convert-to", "pdf", "--outdir", str(work), str(source),
        ]
        env = {**os.environ, "HOME": tmp}
        with _lock:
            try:
                proc = subprocess.run(  # noqa: S603 — fixed argv, no shell, temp paths only
                    command, capture_output=True, check=False, env=env,
                    timeout=settings.soffice_timeout_seconds,
                )
            except subprocess.TimeoutExpired as exc:
                logger.error("soffice timed out after %ss", settings.soffice_timeout_seconds)
                raise ConversionError(
                    "The PDF conversion timed out. Try again, or download the PowerPoint."
                ) from exc
            except OSError as exc:
                logger.error("soffice could not be started: %s", exc)
                raise ConversionError(
                    "The PDF converter could not be started on this server."
                ) from exc
        output = work / "deck.pdf"
        if proc.returncode != 0 or not output.exists():
            detail = (proc.stderr or proc.stdout or b"")[-800:].decode("utf-8", "replace")
            logger.error("soffice exit %s without a PDF: %s", proc.returncode, detail)
            raise ConversionError(
                "The PDF could not be produced from the PowerPoint. Try again, "
                "or download the PowerPoint."
            )
        data = output.read_bytes()
    if not data.startswith(b"%PDF"):
        raise ConversionError("The PDF converter returned an unreadable file.")
    return data


def render_pdf(req: PresentationRequest) -> bytes:
    """The deck as PDF: the PPTX build (gate included) converted by
    LibreOffice, or the PyMuPDF renderer when LibreOffice is unavailable
    and PDF_CONVERTER=auto."""
    global _fallback_warned
    if converter_in_use() == "libreoffice":
        return pptx_to_pdf(build_pptx(req))
    if get_settings().pdf_converter == "auto" and not _fallback_warned:
        logger.warning(
            "LibreOffice (soffice) not found — PDF exports use the built-in "
            "PyMuPDF renderer. Install libreoffice-impress for PPTX-faithful PDFs."
        )
        _fallback_warned = True
    return build_pdf(req)
