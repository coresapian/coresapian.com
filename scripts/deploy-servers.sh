#!/bin/bash
# ─────────────────────────────────────────────────────────
# deploy-servers.sh — Push the unified relay server to LXC 103
#
# v3: single merged multiplayer + chat relay (mp_server.js) replaces the
# separate anonymous_chat_server.js / mp_server.js pair. Renders systemd +
# nginx + fail2ban configs from server/templates/, pushes the server code,
# installs the hardened unit, restarts, and disables the retired
# coresapian-anonymous-chat unit.
#
# Also updates /etc/nginx/sites-available/coresapian so /ws/chat points at
# the merged relay port (8082) instead of the old standalone chat port.
#
# Run from the repo root:
#   bash scripts/deploy-servers.sh [proxmox-host] [lxc-id]
# ─────────────────────────────────────────────────────────

set -euo pipefail

PROXMOX_HOST="${1:-root@192.168.0.10}"
LXC_ID="${2:-103}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")/server"
TEMPLATE_DIR="$SERVER_DIR/templates"
TEMP_REMOTE="/tmp/coresapian-relay-$(date +%s)"

# ── Site values (rendered into templates) ─────────────────────────
SITE_NAME="CoreSapian"
SITE_SLUG="coresapian"
SERVICE_NAME="coresapian-mp.service"
APP_DIR="coresapian-mp"
MP_PORT="8082"
ALLOWED_ORIGINS="coresapian.com,game.coresapian.com,localhost"
RETIRED_UNITS="coresapian-anonymous-chat"

echo "==> Rendering configs from templates..."
RENDER_DIR="$(mktemp -d)"
trap 'rm -rf "$RENDER_DIR"' EXIT

render() {
    sed -e "s/{{SERVICE_NAME}}/$SERVICE_NAME/g" \
        -e "s/{{SITE_NAME}}/$SITE_NAME/g" \
        -e "s/{{SITE_SLUG}}/$SITE_SLUG/g" \
        -e "s/{{APP_DIR}}/$APP_DIR/g" \
        -e "s/{{MP_PORT}}/$MP_PORT/g" \
        -e "s/{{ALLOWED_ORIGINS}}/$ALLOWED_ORIGINS/g" \
        "$TEMPLATE_DIR/$1" > "$RENDER_DIR/$2"
}

render mp-server.service "$SERVICE_NAME"
render nginx-websocket.conf "$SITE_SLUG-relay.conf"
render fail2ban-jail.conf "$SITE_SLUG-honeypot-jail.conf"
render fail2ban-filter.conf "$SITE_SLUG-honeypot-filter.conf"

echo "==> Deploying unified relay to LXC $LXC_ID via $PROXMOX_HOST ..."

ssh "$PROXMOX_HOST" "mkdir -p $TEMP_REMOTE"

scp -q "$SERVER_DIR/config.js" "$SERVER_DIR/mp_server.js" \
    "$SERVER_DIR/package.json" "$SERVER_DIR/package-lock.json" \
    "$RENDER_DIR/$SERVICE_NAME" \
    "$PROXMOX_HOST:$TEMP_REMOTE/"

ssh "$PROXMOX_HOST" "bash -s" << REMOTE_SCRIPT
set -euo pipefail
LXC_ID="$LXC_ID"
TEMP_REMOTE="$TEMP_REMOTE"
APP_DIR="$APP_DIR"
SERVICE_NAME="$SERVICE_NAME"
RETIRED_UNITS="$RETIRED_UNITS"

for f in config.js mp_server.js package.json package-lock.json; do
    pct push \$LXC_ID "\$TEMP_REMOTE/\$f" /opt/\$APP_DIR/\$f
done
pct push \$LXC_ID "\$TEMP_REMOTE/\$SERVICE_NAME" /etc/systemd/system/\$SERVICE_NAME
rm -rf "\$TEMP_REMOTE"

pct exec \$LXC_ID -- bash -c '
set -e
cd /opt/'"$APP_DIR"' && npm install --omit=dev --no-audit --no-fund >/dev/null
# Chat persistence dir must be writable by the service user (www-data)
mkdir -p /data && chown -R www-data:www-data /data
# Fresh app dirs from pct push are root-only; the relay runs as www-data.
chmod -R a+rX /opt/'"$APP_DIR"'
systemctl daemon-reload
systemctl enable --now '"$SERVICE_NAME"'
systemctl restart '"$SERVICE_NAME"'
# Retire the standalone anonymous chat server — merged into the relay in v3
for u in '"$RETIRED_UNITS"'; do
    [ -n "\$u" ] && systemctl disable --now "\$u" 2>/dev/null || true
done
# Point /ws/chat at the merged relay port (was: standalone chat on 3001)
if grep -q "proxy_pass http://127.0.0.1:3001" /etc/nginx/sites-available/coresapian 2>/dev/null; then
    sed -i "s|proxy_pass http://127.0.0.1:3001|proxy_pass http://127.0.0.1:8082|" /etc/nginx/sites-available/coresapian
    nginx -t && systemctl reload nginx
    echo "  nginx: /ws/chat now proxies to merged relay :8082"
fi
# Ensure exact-match /ws proxies to the merged relay (game client endpoint).
# NOTE: the rendered snippet in /etc/nginx/snippets/ is NOT included by the
# site conf, so install this location directly. Idempotent via the grep guard;
# inserted before the location /ws/mp block (one per server block).
SITE_CONF="/etc/nginx/sites-available/coresapian"
if ! grep -q "location = /ws" "\$SITE_CONF" 2>/dev/null; then
    sed -i "s|    location /ws/mp {|    # Game client WS: exact-match /ws -> unified relay\\n    location = /ws {\\n        proxy_pass http://127.0.0.1:8082;\\n        proxy_http_version 1.1;\\n        proxy_set_header Upgrade \\\$http_upgrade;\\n        proxy_set_header Connection upgrade;\\n        proxy_set_header Host \\\$host;\\n        proxy_set_header X-Real-IP \\\$remote_addr;\\n        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;\\n        proxy_set_header X-Forwarded-Proto \\\$scheme;\\n        proxy_read_timeout 3600s;\\n        proxy_send_timeout 3600s;\\n    }\\n    location /ws/mp {|" "\$SITE_CONF"
    grep -q "location = /ws" "\$SITE_CONF" 2>/dev/null || { echo "  ERROR: anchor location /ws/mp not found in site conf" >&2; exit 1; }
    if nginx -t 2>/dev/null; then
        systemctl reload nginx
        echo "  nginx: exact-match /ws now proxies to merged relay :8082"
    else
        echo "  ✗ nginx -t FAILED after adding location = /ws" >&2
        exit 1
    fi
fi
# Wait for the unit to settle — is-active exits non-zero while the
# service is still activating, which would trip set -e on a bare call.
for i in \$(seq 1 15); do
    if systemctl is-active --quiet '"$SERVICE_NAME"'; then break; fi
    sleep 1
done
systemctl is-active --quiet '"$SERVICE_NAME"' || \
    { echo "ERROR: '"$SERVICE_NAME"' failed to become active" >&2; exit 1; }
'
REMOTE_SCRIPT

echo "==> Relay restarted. Verifying health..."
ssh "$PROXMOX_HOST" "pct exec $LXC_ID -- curl -s http://127.0.0.1:$MP_PORT/" | grep -q '"ok":true' \
    && echo "  ✓ Relay health OK" || { echo "  ✗ Relay health FAILED"; exit 1; }

echo ""
echo "  ✓ Done — unified relay v3 running on LXC $LXC_ID"
echo ""
echo "  Remaining manual steps (first v3 deploy only):"
echo "    1. fail2ban: install $SITE_SLUG-honeypot-{jail,filter}.conf if not present"
echo "       (rendered copies in $RENDER_DIR/)"
echo "    2. Repo nginx_coresapian.conf: /ws/chat updated to :$MP_PORT (in-repo copy only —"
echo "       live config was patched by this script)"
