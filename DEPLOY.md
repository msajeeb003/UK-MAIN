# Deployment guide — UK/EU hosting

Two containers and one managed database:

| Part | What | Where it runs |
|---|---|---|
| **Backend** (`Dockerfile`) | FastAPI: extraction pipeline, projects, documents, exports | A container host in the UK/EU with a persistent volume at `/data` |
| **Web** (`web/Dockerfile`) | Next.js app; proxies `/api/*` to the backend server-side | Same host (compose) or Vercel with the London region |
| **Supabase** | PostgreSQL (projects, documents, config), Auth (sign-in), Storage (uploaded files) | A Supabase project created in **eu-west-2 (London)** or **eu-west-1 (Ireland)** |

Everything under `deploy/` is ready to use; this guide says which file
goes where. Data residency (BRD 2.11): keep all three parts in UK/EU
regions. Note that extraction sends document text to the model provider
(Anthropic or OpenAI) — see `docs/DATA_PROCESSING.md` for the
no-training/no-retention posture and the terms to file.

> **Why not Vercel for the backend?** Serverless functions have no
> persistent disk, a size limit smaller than the OCR stack and request
> timeouts shorter than an extraction. The backend needs a long-running
> container; the web app is fine on Vercel.

## 1. Supabase (once)

1. **Create the project** in a UK/EU region (Dashboard → New project →
   Region *London* or *Ireland*). Note the project ref
   (`https://<ref>.supabase.co`).
2. **Database URL** — Dashboard → *Connect* → **Session pooler** URI:
   `postgresql://postgres.<ref>:<password>@aws-<n>-<region>.pooler.supabase.com:5432/postgres`.
   Append `?sslmode=require`. Percent-encode special characters in the
   password (`!`→`%21`, `+`→`%2B`, `@`→`%40`, `#`→`%23`). The *direct*
   host `db.<ref>.supabase.co:5432` is IPv6-only — use it only from a
   host with IPv6 egress. Both work with this code; the schema is created
   on first start and new columns are added automatically afterwards.
3. **Auth** — Project Settings → API: copy the **anon/publishable key**
   (web) and the **JWT secret** (backend `SUPABASE_JWT_SECRET`; or leave it
   empty and the backend verifies against the project JWKS). Authentication
   → Providers → Email: **turn off "Allow new users to sign up"** (BRD 2.10:
   no self-registration).
4. **Storage** — create a **private** bucket named `documents` (or set
   `SUPABASE_STORAGE_BUCKET`). Copy the **service-role key** (backend only;
   never in the browser bundle).
5. **Users** — from a machine with the service-role key in `web/.env.local`:

   ```bash
   cd web && npm run users -- create broker@ukcib.co.uk "Sam Broker"
   npm run users -- role admin@ukcib.co.uk admin      # /config/* access
   ```

6. **Database migrations** run automatically: the container entrypoint applies
   `alembic upgrade head` (backend/migrations) before the API starts. The first
   run on the existing database adopts the tables, adds the CHECK constraints
   and enables row-level security (docs/DATABASE.md).
7. **PDF export** — the image installs LibreOffice (Impress) so the PDF is
   converted from the generated PowerPoint; `GET /health` reports
   `"pdf_converter": "libreoffice"` when it is in use.
8. **Backups** — enable daily backups / PITR on the Supabase plan. The
   app's own backups (`docs/BACKUP.md`) cover `/data` (app SQLite DB,
   exports, and files when Storage is off).

## 2. Environment variables

Backend: `deploy/.env.production.example` (copy to `.env` on a VPS, or
paste into the platform's Variables). Web: `deploy/web.env.production.example`.
The backend **refuses to start** in production without: `APP_ENV=production`,
`COOKIE_SECURE=true`, a model key + `LLM_NO_TRAINING_ACK=true`, a PostgreSQL
`DATABASE_URL`, an https `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase PostgreSQL (pooler URI, `?sslmode=require`) |
| `SUPABASE_URL` · `SUPABASE_JWT_SECRET` · `SUPABASE_JWT_AUDIENCE` | Verify the web app's bearer tokens |
| `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_STORAGE_BUCKET` | Uploaded documents in Supabase Storage |
| `ADMIN_EMAILS` | Extra admins for `/config/*` (besides `app_metadata.role = admin`) |
| `LLM_PROVIDER` · `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` · `LLM_NO_TRAINING_ACK` | Extraction model |
| `AZURE_ENDPOINT` · `AZURE_KEY` | OCR for scanned PDFs (UK/EU Azure region), else build with `INSTALL_OCR=1` |
| `DATA_DIR` | Persistent volume (`/data`) |
| `FORWARDED_ALLOW_IPS` | Proxies trusted for the client IP (login lockout, rate limit) |
| `WORKERS` | gunicorn workers (2 for a 2 vCPU host) |
| `BACKUP_*` · `SENTRY_DSN` · `RETENTION_DAYS` | Operations (`docs/BACKUP.md`, `docs/OBSERVABILITY.md`, `docs/DATA_RETENTION.md`) |

Web: `BACKEND_URL` (private backend address, runtime) and the public
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (build time).

## 3. Option A — Fly.io, London (`deploy/fly.toml`)

Managed containers, persistent volume, HTTPS and the `lhr` region.

```bash
fly auth login
fly launch --no-deploy --copy-config --config deploy/fly.toml --name quote-tool-backend
fly volumes create quote_data --region lhr --size 10 --app quote-tool-backend
cp deploy/.env.production.example deploy/.env.production   # fill in, keep out of git
fly secrets set --app quote-tool-backend $(grep -v '^#' deploy/.env.production | grep . | xargs)
fly deploy --config deploy/fly.toml --dockerfile Dockerfile
fly status --app quote-tool-backend        # health check hits /readyz
```

The web app: deploy `web/` to Vercel (Project → Settings → Functions →
Region **London (lhr1)**) with `BACKEND_URL=https://quote-tool-backend.fly.dev`
and the two `NEXT_PUBLIC_*` values; or run `web/Dockerfile` as a second Fly
app in `lhr` with `BACKEND_URL` pointing at the backend's internal address
(`http://quote-tool-backend.internal:8000`).

The CI workflow `.github/workflows/docker-image.yml` publishes both images
to GHCR on every push to `main` and deploys the backend to Fly when the
repository secret `FLY_API_TOKEN` is set.

## 4. Option B — Railway, EU (`deploy/railway.toml`)

1. railway.app → New Project → Deploy from GitHub → `msajeeb003/UK-MAIN`.
2. Service → Settings → **Region: europe-west4 (Amsterdam)**; Config file
   path `deploy/railway.toml` (or copy it to the repo root).
3. Settings → Volumes → mount at `/data`.
4. Variables → paste `deploy/.env.production` (filled in).
5. Settings → Networking → Generate Domain (HTTPS is automatic).
   Add a second service from `web/Dockerfile` with `BACKEND_URL` set to the
   backend's private URL (`http://<service>.railway.internal:8000`).

## 5. Option C — a UK/EU VPS with Docker Compose (`deploy/docker-compose.yml`)

Any Ubuntu 24.04 VPS in a UK/EU data centre (Hetzner Falkenstein/Nuremberg,
OVH London, IONOS UK, Fasthosts …), 2 vCPU / 4 GB is plenty for the pilot.
Backend, web and Caddy (automatic Let's Encrypt HTTPS) run as one stack;
only ports 80/443 are published.

```bash
# as root on the fresh server
curl -fsSL https://raw.githubusercontent.com/msajeeb003/UK-MAIN/main/deploy/bootstrap-vps.sh | bash
# as the deploy user
cd /opt/quote-tool
cp deploy/.env.production.example .env          # backend — fill in
cp deploy/web.env.production.example web.env    # web — fill in
printf 'DOMAIN=quotes.example.co.uk\nAPI_DOMAIN=api.quotes.example.co.uk\n' > deploy/.env
deploy/deploy.sh                                # build, start, wait for /readyz
```

Point `DOMAIN` and `API_DOMAIN` at the server before the first start so
Caddy can issue certificates. `deploy/quote-tool.service` (installed by
the bootstrap) brings the stack up on reboot. Updates:

```bash
cd /opt/quote-tool && deploy/deploy.sh v1.5.0    # or a branch / commit
```

Encryption at rest: use the provider's encrypted volume (or full-disk
encryption) for the Docker data root; `/data` holds the app SQLite DB,
exports and — only when Supabase Storage is off — the uploaded documents.

## 6. After the first start

- `GET https://api.<domain>/readyz` → 200 (disk, database).
- Sign in on `https://<domain>` with a Supabase user; create a project;
  upload a quote; check the upload card reaches *Extracted*.
- `GET /config/insurers` as an admin → 200; as a broker → 403.
- Watch the logs for `Project store ready (postgresql)` and
  `Document storage: Supabase bucket`.

## 7. Operations

- **Logs**: JSON lines with request id and user id (`docs/OBSERVABILITY.md`);
  `docker compose -f deploy/docker-compose.yml logs -f backend` on a VPS,
  `fly logs` / Railway's log view otherwise. Set `SENTRY_DSN` for errors.
- **Backups**: Supabase backups/PITR for projects, documents metadata and
  config; `docs/BACKUP.md` for `/data`.
- **Key rotation**: `docs/KEY_ROTATION.md`. Rotating the Supabase JWT
  secret signs everyone out; rotate the service-role key with the bucket
  policy in mind.
- **Scaling**: one container with `WORKERS=2` serves the pilot (3–4 users).
  Extraction concurrency is capped at three per process (`MAX_CONCURRENT`
  in `app/api/jobs.py`); raise `WORKERS`/machine size before that.
- **Retention / erasure**: `docs/DATA_RETENTION.md`; `DELETE /projects/{id}`
  removes rows, objects and files.
