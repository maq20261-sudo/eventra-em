#!/usr/bin/env bash
# One-time setup of a fresh Lightsail Ubuntu 24.04 instance for GatherSpace.
# Run as the default `ubuntu` user:
#
#   curl -fsSL https://raw.githubusercontent.com/maq20261-sudo/eventra-em/main/deploy/setup-server.sh -o setup-server.sh
#   sudo bash setup-server.sh
#
# Safe to re-run. It installs Docker, adds 2 GB swap (the 1 GB plan needs it),
# turns on the firewall and automatic security updates, creates
# /opt/gatherspace and schedules the nightly database backup.
set -euo pipefail

APP_DIR=/opt/gatherspace
APP_USER=ubuntu

echo "== System updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl ufw unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$APP_USER"
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
JSON
systemctl restart docker

echo "== Swap (2 GB)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

echo "== Firewall (SSH, HTTP, HTTPS)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "== App directory"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "== Nightly backup at 02:30 IST (21:00 UTC)"
CRON_LINE="0 21 * * * $APP_DIR/backup.sh >> $APP_DIR/backup.log 2>&1"
{ crontab -u "$APP_USER" -l 2>/dev/null | grep -v 'backup.sh' || true; echo "$CRON_LINE"; } | crontab -u "$APP_USER" -

echo
echo "Done. Next (as $APP_USER, see docs/DEPLOYMENT.md):"
echo "  1. Copy docker-compose.prod.yml, Caddyfile, backup.sh into $APP_DIR (the GitHub deploy does this too)"
echo "  2. Create $APP_DIR/backend.env and $APP_DIR/firebase-admin.json"
echo "  3. Log out and back in (docker group), then deploy"
