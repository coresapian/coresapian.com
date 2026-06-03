#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Source .env
if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "ERROR: .env file not found."
  echo "Run: cp .env.example .env   and edit the values."
  exit 1
fi
set -a; source "$PROJECT_DIR/.env"; set +a

# Validate required variables
missing=""
[ -n "${CT_IP:-}" ]              || missing="$missing  CT_IP\n"
[ -n "${CORECHAT_REMOTE_DIR:-}" ] || missing="$missing  CORECHAT_REMOTE_DIR\n"
[ -n "${CORECHAT_NODE_MAJOR:-}" ] || missing="$missing  CORECHAT_NODE_MAJOR\n"
[ -n "${CORECHAT_PORT:-}" ]       || missing="$missing  CORECHAT_PORT\n"
if [ -n "$missing" ]; then
  echo "ERROR: Missing required variables in .env:"
  printf "$missing"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════
# Coresapian coreChat - Deploy to Proxmox LXC CT 103
#
# Builds and deploys the coreChat (TheLounge fork) IRC web client
# to LXC 103. Installs Node.js if missing, rsyncs the app, builds it,
# installs the systemd service, and updates Nginx.
#
# Prerequisites:
#   - SSH access to the CT (configure PROXMOX_HOST/CT_IP in .env)
#   - rsync available on the local machine
#
# Usage:
#   cp .env.example .env   # edit values, then:
#   ./scripts/deploy_corechat.sh
# ═══════════════════════════════════════════════════════════════════

REMOTE_HOST="${1:-root@$CT_IP}"
REMOTE_DIR="$CORECHAT_REMOTE_DIR"
NODE_MAJOR="$CORECHAT_NODE_MAJOR"
CHAT_PORT="$CORECHAT_PORT"

CORECHAT_SRC="$PROJECT_DIR/coreChat"

echo "=== Coresapian coreChat Deploy ==="
echo ""

# ── Pre-flight checks ─────────────────────────────────────────────
if [ ! -d "$CORECHAT_SRC" ]; then
    echo "ERROR: coreChat source not found at $CORECHAT_SRC"
    exit 1
fi

if ! command -v rsync &>/dev/null; then
    echo "ERROR: rsync not found. Install it first."
    exit 1
fi

echo "Remote: $REMOTE_HOST"
echo "Target: $REMOTE_DIR"
echo ""

# ── Step 1: Install Node.js 20.x on remote (if needed) ───────────
echo "[1/7] Checking Node.js on remote..."

NODE_CHECK=$(ssh "$REMOTE_HOST" "command -v node && node --version" 2>/dev/null || true)

if echo "$NODE_CHECK" | grep -qE "^v(1[8-9]|[2-9][0-9])"; then
    echo "  Node.js already installed: $(echo "$NODE_CHECK" | tail -1)"
else
    echo "  Installing Node.js ${NODE_MAJOR}.x via NodeSource..."
    ssh "$REMOTE_HOST" bash -s <<REMOTE_NODE_INSTALL
        set -e
        apt-get update -qq
        apt-get install -y -qq curl ca-certificates gnupg
        # NodeSource GPG key + repo
        curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
            | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
        echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
            > /etc/apt/sources.list.d/nodesource.list
        apt-get update -qq
        apt-get install -y -qq nodejs
        node --version
        npm --version
REMOTE_NODE_INSTALL
    echo "  Node.js installed."
fi
echo ""

# ── Step 2: Install yarn on remote (if needed) ────────────────────
echo "[2/7] Checking yarn on remote..."

YARN_CHECK=$(ssh "$REMOTE_HOST" "command -v yarn" 2>/dev/null || true)
if [ -z "$YARN_CHECK" ]; then
    echo "  Installing yarn globally..."
    ssh "$REMOTE_HOST" "npm install -g yarn"
else
    echo "  yarn already installed: $(ssh "$REMOTE_HOST" "yarn --version")"
fi
echo ""

# ── Step 3: Create target directory and rsync ─────────────────────
echo "[3/7] Syncing coreChat files to remote..."
ssh "$REMOTE_HOST" "mkdir -p $REMOTE_DIR"

# rsync the coreChat directory, excluding build artifacts and git
rsync -avz --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='.DS_Store' \
    "$CORECHAT_SRC/" \
    "$REMOTE_HOST:$REMOTE_DIR/"

echo "  Files synced."
echo ""

# ── Step 4: Install dependencies on remote ────────────────────────
echo "[4/7] Installing production dependencies..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && yarn install --production"
echo "  Dependencies installed."
echo ""

# ── Step 5: Build on remote ───────────────────────────────────────
echo "[5/7] Building coreChat..."
# Build needs devDependencies for webpack + tsc, so install fully then build
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && yarn install && yarn build"
echo "  Build complete."
echo ""

# ── Step 6: Install and start systemd service ─────────────────────
echo "[6/7] Installing systemd service..."
scp "$PROJECT_DIR/server/coresapian-chat.service" \
    "$REMOTE_HOST:/tmp/coresapian-chat.service"
ssh "$REMOTE_HOST" bash -s <<REMOTE_SERVICE
    mv /tmp/coresapian-chat.service /etc/systemd/system/coresapian-chat.service
    systemctl daemon-reload
    systemctl enable coresapian-chat
    systemctl restart coresapian-chat
    sleep 2
    systemctl status coresapian-chat --no-pager || true
REMOTE_SERVICE
echo "  Service installed and started."
echo ""

# ── Step 7: Update Nginx config on remote ─────────────────────────
echo "[7/7] Updating Nginx configuration..."

ssh "$REMOTE_HOST" bash -s <<'REMOTE_NGINX'
set -e

NGINX_CONF="/etc/nginx/sites-available/coresapian"

# Check if /chat block already exists
if grep -q "location /chat" "$NGINX_CONF" 2>/dev/null; then
    echo "  /chat location block already present in $NGINX_CONF"
else
    # Insert the /chat block before the closing } of the server {} block
    # We add it just before the last closing brace
    sed -i '/^[[:space:]]*}$/i\
    # coreChat IRC client\
    location /chat {\
        proxy_pass http://127.0.0.1:9000;\
        proxy_http_version 1.1;\
        proxy_set_header Upgrade $http_upgrade;\
        proxy_set_header Connection "upgrade";\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\
        proxy_set_header X-Forwarded-Proto $scheme;\
        proxy_read_timeout 600s;\
    }' "$NGINX_CONF"

    echo "  Added /chat location block to $NGINX_CONF"
fi

# Test and reload nginx
nginx -t && systemctl reload nginx
echo "  Nginx reloaded."
REMOTE_NGINX
echo ""

echo "=== Deploy complete ==="
echo ""
echo "coreChat is running on port $CHAT_PORT"
echo "Access via: http://coresapian.com/chat"
echo ""
echo "Useful commands:"
echo "  Status:   ssh $REMOTE_HOST 'systemctl status coresapian-chat'"
echo "  Logs:     ssh $REMOTE_HOST 'journalctl -u coresapian-chat -f'"
echo "  Restart:  ssh $REMOTE_HOST 'systemctl restart coresapian-chat'"
echo "  Stop:     ssh $REMOTE_HOST 'systemctl stop coresapian-chat'"
echo ""
