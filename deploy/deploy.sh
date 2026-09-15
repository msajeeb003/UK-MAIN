#!/usr/bin/env bash
# Deploy / update the compose stack on the VPS: pull the requested ref,
# build both images, restart with zero surprises, and wait for the backend
# to report ready. Safe to re-run; used by the systemd unit for a plain
# restart too.
#
#   deploy/deploy.sh            # deploy the current checkout
#   deploy/deploy.sh v1.4.0     # deploy a tag / branch / commit
#
# Required next to the repository root: .env (backend), web.env (web) and
# deploy/.env with DOMAIN / API_DOMAIN / NEXT_PUBLIC_* for the compose file.
set -euo pipefail

cd "$(dirname "$0")/.."
REF="${1:-}"
COMPOSE=(docker compose --env-file deploy/.env -f deploy/docker-compose.yml)

for f in .env web.env deploy/.env; do
  [ -f "$f" ] || { echo "Missing $f — copy the matching deploy/*.example and fill it in."; exit 1; }
done
# The compose file needs the public Supabase values at build time; they
# live in web.env, so export them for this run.
set -a; . ./web.env; set +a

if [ -n "$REF" ]; then
  echo "==> Fetching $REF"
  git fetch --tags origin
  git checkout --quiet "$REF"
  git pull --ff-only --quiet origin "$REF" 2>/dev/null || true
fi
echo "==> Deploying $(git rev-parse --short HEAD) ($(git log -1 --format=%s))"

echo "==> Building images"
"${COMPOSE[@]}" build --pull

echo "==> Starting"
"${COMPOSE[@]}" up -d --remove-orphans

echo "==> Waiting for the backend to be ready"
for i in $(seq 1 40); do
  if "${COMPOSE[@]}" exec -T backend python -c \
      "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=4).status == 200 else 1)" 2>/dev/null; then
    echo "==> Backend ready"
    "${COMPOSE[@]}" ps
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 3
done
echo "!! Backend did not become ready — recent logs:"
"${COMPOSE[@]}" logs --tail=80 backend
exit 1
