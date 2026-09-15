# Insurance Quote Comparison Tool — FastAPI backend image.
# Runs on Fly.io / Railway / Render / any Docker host (see DEPLOY.md and
# deploy/ for the provider files).
#
#   docker build -t quote-tool-backend .
#   docker run -p 8000:8000 --env-file .env -v quote_data:/data quote-tool-backend
#
# The open-source OCR stack (Docling + PyTorch, several GB) is NOT
# installed by default — scanned PDFs then need Azure keys, or rebuild
# with:  docker build --build-arg INSTALL_OCR=1 .

FROM python:3.14-slim

# Patch base-image OS packages so the image ships without known fixable
# HIGH/CRITICAL CVEs (enforced by the Trivy scan in CI).
# LibreOffice (Impress only) converts the generated PowerPoint to the PDF the
# broker downloads (app/services/pdf_convert.py); Carlito/Liberation are the
# metric-compatible substitutes for the deck's Calibri/Arial theme fonts.
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
         libreoffice-impress fontconfig fonts-crosextra-carlito fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app && useradd --system --gid app --home-dir /srv --shell /usr/sbin/nologin app

WORKDIR /srv

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

ARG INSTALL_OCR=0
COPY backend/requirements-ocr.txt backend/requirements-ocr.txt
RUN if [ "$INSTALL_OCR" = "1" ]; then \
      pip install --no-cache-dir -r backend/requirements-ocr.txt; \
    fi

COPY backend backend
COPY frontend frontend
COPY entrypoint.sh entrypoint.sh

# The presentation template's fonts (Poppins, Antonio — OFL) so LibreOffice
# renders the PDF with the same type as the PowerPoint.
RUN mkdir -p /usr/share/fonts/truetype/quote-tool \
    && cp backend/app/assets/fonts/*.ttf /usr/share/fonts/truetype/quote-tool/ \
    && fc-cache -f >/dev/null

# Make the `app` package importable for gunicorn AND `python -m app.backup`.
ENV PYTHONPATH=/srv/backend \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
# App SQLite DB (users, documents metadata, jobs, audit) + retained
# documents + exports when Supabase Storage is not configured — mount a
# persistent volume here. Projects live in PostgreSQL (DATABASE_URL).
ENV DATA_DIR=/data
RUN mkdir -p /data && chown app:app /data && chmod +x entrypoint.sh

USER app
EXPOSE 8000

# Liveness only (no external dependencies): /readyz adds disk + DB checks
# and is what the platform's own health check should call (see deploy/).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4).status == 200 else 1)"

# entrypoint.sh takes a pre-start safety backup, then launches gunicorn with
# several Uvicorn workers (--timeout 180 because an extraction waits 1-2 min
# on the LLM; the default 30s would kill the worker mid-request). WORKERS
# falls back to WEB_CONCURRENCY, then 2.
CMD ["sh", "entrypoint.sh"]
