#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 VPS in a UK/EU data centre
# (e.g. Hetzner Falkenstein/Nuremberg, OVH London, IONOS UK, Fasthosts):
# Docker Engine + Compose, firewall, automatic security updates, a deploy
# user, and the application directory. Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/msajeeb003/UK-MAIN/main/deploy/bootstrap-vps.sh | bash
#
# Afterwards, as the deploy user: clone the repo to /opt/quote-tool, fill
# in .env and web.env from deploy/*.example, then run deploy/deploy.sh.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/msajeeb003/UK-MAIN.git}"
APP_DIR="${APP_DIR:-/opt/quote-tool}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"

echo "==> OS updates + automatic security patches"
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg ufw unattended-upgrades fail2ban git
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Docker Engine + Compose plugin"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

echo "==> Firewall: SSH, HTTP, HTTPS only (the app ports are never published)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> Deploy user + application directory"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
mkdir -p "$APP_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$APP_DIR"
fi

echo "==> systemd unit so the stack restarts with the host"
sed "s#/opt/quote-tool#$APP_DIR#g" "$APP_DIR/deploy/quote-tool.service" > /etc/systemd/system/quote-tool.service
systemctl daemon-reload
systemctl enable quote-tool

cat <<EOF

Done. Next, as $DEPLOY_USER:
  cd $APP_DIR
  cp deploy/.env.production.example .env        # fill in (Supabase, LLM key, …)
  cp deploy/web.env.production.example web.env  # fill in
  echo 'DOMAIN=quotes.example.co.uk' > deploy/.env; echo 'API_DOMAIN=api.quotes.example.co.uk' >> deploy/.env
  deploy/deploy.sh
Point the two DNS A/AAAA records at this server first; Caddy issues the certificates on first start.
EOF
