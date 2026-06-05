#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# deploy_anonymous_chat.sh
# Deploys the anonymous chat WebSocket server to Proxmox LXC 103
#
# Target: root@192.168.0.148 (container 103)
# Installs: Node.js + ws library + systemd service + nginx proxy
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

REMOTE_HOST="root@192.168.0.148"
REMOTE_DIR="/opt/coresapian/server"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "═══════════════════════════════════════════════════════════════"
echo "  Coresapian Anonymous Chat — Deploy to LXC 103"
echo "═══════════════════════════════════════════════════════════════"

# ── Check Node.js on remote ─────────────────────────────────────────
echo "[1/6] Checking Node.js on remote..."
if ! ssh "$REMOTE_HOST" "command -v node &>/dev/null"; then
  echo "  Node.js not found — installing via apt (Debian repo)..."
  ssh "$REMOTE_HOST" "apt-get update && apt-get install -y nodejs npm"
fi
echo "  Node.js $(ssh "$REMOTE_HOST" 'node -v') ✓"

# ── Create remote directory ─────────────────────────────────────────
echo "[2/6] Creating remote directories..."
ssh "$REMOTE_HOST" "mkdir -p $REMOTE_DIR /data"

# ── Copy server files ──────────────────────────────────────────────
echo "[3/6] Copying server files..."
scp "$SCRIPT_DIR/anonymous_chat_server.js" "$REMOTE_HOST:$REMOTE_DIR/"
scp "$SCRIPT_DIR/package.json" "$REMOTE_HOST:$REMOTE_DIR/"

# ── Install npm dependencies ───────────────────────────────────────
echo "[4/6] Installing npm dependencies..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && npm install --production"

# ── Deploy systemd service ─────────────────────────────────────────
echo "[5/6] Deploying systemd service..."
scp "$SCRIPT_DIR/coresapian-anonymous-chat.service" \
    "$REMOTE_HOST:/etc/systemd/system/coresapian-anonymous-chat.service"
ssh "$REMOTE_HOST" "systemctl daemon-reload && systemctl enable coresapian-anonymous-chat && systemctl restart coresapian-anonymous-chat"

# ── Update nginx config ────────────────────────────────────────────
echo "[6/6] Updating nginx config..."
scp "$SCRIPT_DIR/nginx_coresapian.conf" \
    "$REMOTE_HOST:/etc/nginx/sites-available/coresapian"
ssh "$REMOTE_HOST" "nginx -t && systemctl reload nginx"

# ── Verify ─────────────────────────────────────────────────────────
echo ""
echo "Verifying..."
sleep 2
if ssh "$REMOTE_HOST" "systemctl is-active coresapian-anonymous-chat" | grep -q active; then
  echo "  ✓ Service is running"
else
  echo "  ✗ Service failed to start!"
  ssh "$REMOTE_HOST" "journalctl -u coresapian-anonymous-chat -n 20 --no-pager"
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ Anonymous chat server deployed!"
echo "  WebSocket endpoint: ws://192.168.0.148/ws/chat"
echo "  Persistence: /data/chatlog.json"
echo "═══════════════════════════════════════════════════════════════"
