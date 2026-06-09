#!/bin/bash
# ─────────────────────────────────────────────────────────
# deploy-honeypot.sh — Deploy honeypot stack to LXC 103
#
# Run from the repo root:
#   bash scripts/honeypot/deploy-honeypot.sh [lxc-ip]
#
# Prerequisites on the LXC:
#   - nginx + fail2ban installed
#   - Cloudflare Tunnel configured (TLS)
#   - This repo cloned/copied to /opt/coresapian/coresapian.com
#
# IMPORTANT: This deploys the honeypot as a SEPARATE nginx config
# file (coresapian-honeypot) alongside the production config
# (coresapian). The production config is NEVER overwritten.
# ─────────────────────────────────────────────────────────

set -euo pipefail

TARGET="${1:-192.168.0.148}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTE_REPO="/opt/coresapian/coresapian.com"

echo "==> Deploying honeypot stack to $TARGET (LXC 103) ..."

# ── Copy config files ──
# NOTE: Honeypot config goes to a SEPARATE file — does NOT touch production
echo "  [1/6] Copying honeypot nginx config (as separate site, NOT overwriting production) ..."
scp "$SCRIPT_DIR/honeypot-nginx.conf" "root@$TARGET:/etc/nginx/sites-available/coresapian-honeypot"

echo "  [2/6] Copying Fail2Ban filter ..."
scp "$SCRIPT_DIR/fail2ban-filter.conf" "root@$TARGET:/etc/fail2ban/filter.d/coresapian-honeypot.conf"

echo "  [3/6] Copying Fail2Ban jail ..."
scp "$SCRIPT_DIR/fail2ban-jail.conf" "root@$TARGET:/etc/fail2ban/jail.d/coresapian-honeypot.conf"

echo "  [4/6] Copying Fail2Ban action ..."
scp "$SCRIPT_DIR/fail2ban-action.conf" "root@$TARGET:/etc/fail2ban/action.d/coresapian-honeypot-alert.conf"

echo "  [4.5/6] Copying alert script ..."
scp "$SCRIPT_DIR/honelert.sh" "root@$TARGET:/usr/local/bin/honelert.sh"

# ── Remote setup ──
echo "  [5/6] Configuring on remote ..."
ssh "root@$TARGET" bash -s <<'REMOTE'
set -e

# Symlink honeypot site as a SEPARATE config — production (coresapian) is untouched
ln -sf /etc/nginx/sites-available/coresapian-honeypot /etc/nginx/sites-enabled/coresapian-honeypot

# Verify production config still exists and warn if missing
if [ ! -f /etc/nginx/sites-available/coresapian ]; then
    echo "  ⚠ WARNING: /etc/nginx/sites-available/coresapian not found!"
    echo "    The production config should be deployed separately."
fi

# Create honeypot log files with correct permissions
touch /var/log/nginx/honeypot-access.log
touch /var/log/honeypot-incidents.log
chmod 640 /var/log/nginx/honeypot-access.log
chmod 640 /var/log/honeypot-incidents.log

# Make alert script executable
chmod +x /usr/local/bin/honelert.sh

# Validate nginx config
nginx -t

# Restart services
systemctl reload nginx
systemctl restart fail2ban

echo "  ✓ Services reloaded"
REMOTE

echo "  [6/6] Verifying Fail2Ban jail is active ..."
ssh "root@$TARGET" "fail2ban-client status coresapian-honeypot" || {
    echo "  ⚠ Jail not active yet — check: fail2ban-client status"
}

echo ""
echo "==> Done! Honeypot active on $TARGET"
echo "    Production config: /etc/nginx/sites-available/coresapian (untouched)"
echo "    Honeypot config:   /etc/nginx/sites-available/coresapian-honeypot (new)"
echo "    Monitor: ssh root@$TARGET tail -f /var/log/honeypot-incidents.log"
echo "    Bans:    ssh root@$TARGET fail2ban-client status coresapian-honeypot"
