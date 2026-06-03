#!/bin/bash
#===============================================================================
# deploy-coresapian.sh
#
# Deploys all coresapian.com services to LXC $CT_ID
# Run from your MacBook: bash scripts/deploy-coresapian.sh
#
# Services deployed:
#   1. Godot dedicated server (coresapian-game.service)
#   2. World Chat WebSocket (coresapian-world-chat.service) -- already running
#   3. coreChat IRC client (coresapian-chat.service)
#   4. Nginx reverse proxy config
#   5. DDNS cron job for dynamic IP
#===============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source .env
if [ ! -f "$REPO_DIR/.env" ]; then
  echo "ERROR: .env file not found."
  echo "Run: cp .env.example .env   and edit the values."
  exit 1
fi
set -a; source "$REPO_DIR/.env"; set +a

# Validate required variables
missing=""
[ -n "${PROXMOX_HOST:-}" ] || missing="$missing  PROXMOX_HOST\n"
[ -n "${CT_ID:-}" ]        || missing="$missing  CT_ID\n"
[ -n "${CT_IP:-}" ]        || missing="$missing  CT_IP\n"
if [ -n "$missing" ]; then
  echo "ERROR: Missing required variables in .env:"
  printf "$missing"
  exit 1
fi

echo "=========================================="
echo "  Coresapian.com Deployment to LXC 103"
echo "  Target: ${CT_IP}"
echo "=========================================="

#-------------------------------------------------------------------------------
# HELPER: Run command inside LXC 103
#-------------------------------------------------------------------------------
lxc_exec() {
    ssh "$PROXMOX_HOST" "pct exec $CT_ID -- bash -c '$1'"
}

#-------------------------------------------------------------------------------
# STEP 1: Deploy Godot dedicated server
#-------------------------------------------------------------------------------
echo ""
echo "[Step 1] Deploying Godot dedicated server..."

# Create server directory
lxc_exec "mkdir -p /opt/coresapian/server /opt/coresapian/data"

# Copy server binary (must be exported first from Godot editor)
if [ -f "${REPO_DIR}/exports/coresapian-server.x86_64" ]; then
    scp "${REPO_DIR}/exports/coresapian-server.x86_64" "$PROXMOX_HOST:/tmp/coresapian-server.x86_64"
    ssh "$PROXMOX_HOST" "pct push $CT_ID /tmp/coresapian-server.x86_64 /opt/coresapian/server/coresapian-server.x86_64"
    lxc_exec "chmod +x /opt/coresapian/server/coresapian-server.x86_64"
    echo "  Server binary deployed."
else
    echo "  WARNING: No server binary found at exports/coresapian-server.x86_64"
    echo "  Export from Godot first: Editor > Export > Linux Dedicated Server"
fi

# Deploy systemd service for game server
ssh "$PROXMOX_HOST" "pct exec $CT_ID -- bash -c 'cat > /etc/systemd/system/coresapian-game.service << EOF
[Unit]
Description=CoreSapian Godot Dedicated Server
After=network.target nginx.service
Wants=nginx.service

[Service]
Type=simple
ExecStart=/opt/coresapian/server/coresapian-server.x86_64 --headless
WorkingDirectory=/opt/coresapian/server
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/coresapian/data

[Install]
WantedBy=multi-user.target
EOF'"

lxc_exec "systemctl daemon-reload"
echo "  coresapian-game.service installed."

#-------------------------------------------------------------------------------
# STEP 2: Deploy coreChat (The Lounge fork)
#-------------------------------------------------------------------------------
echo ""
echo "[Step 2] Deploying coreChat..."

# Install Node.js if not present
lxc_exec "which node || (curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs)"

# Copy coreChat source
echo "  Copying coreChat source to LXC..."
ssh "$PROXMOX_HOST" "pct exec $CT_ID -- mkdir -p /opt/coresapian/coreChat"
tar -C "${REPO_DIR}" -czf /tmp/corechat-src.tar.gz --exclude='node_modules' --exclude='.git' coreChat/
scp /tmp/corechat-src.tar.gz "$PROXMOX_HOST:/tmp/corechat-src.tar.gz"
ssh "$PROXMOX_HOST" "pct push $CT_ID /tmp/corechat-src.tar.gz /tmp/corechat-src.tar.gz"
lxc_exec "cd /opt/coresapian/coreChat && tar xzf /tmp/corechat-src.tar.gz --strip-components=1"

# Install dependencies and build
lxc_exec "cd /opt/coresapian/coreChat && npm install --production 2>&1 | tail -5"
lxc_exec "cd /opt/coresapian/coreChat && npx webpack --config webpack.config.js --mode production 2>&1 | tail -5 || echo 'Build may have used different command'"

# Create coreChat config
lxc_exec "mkdir -p /opt/coresapian/coreChat/.thelounge"
lxc_exec 'cat > /opt/coresapian/coreChat/.thelounge/config.js << EOFCONF
module.exports = {
    public: false,
    host: "127.0.0.1",
    port: 9000,
    theme: "default",
    prefetch: false,
    defaults: {
        name: "coreChat",
        host: "irc.libera.chat",
        port: 6697,
        tls: true,
        rejectUnauthorized: true,
    },
    storage: {
        engine: "sqlite",
    },
};
EOFCONF'

# Deploy systemd service for coreChat
lxc_exec 'cat > /etc/systemd/system/coresapian-chat.service << EOF
[Unit]
Description=CoreSapian coreChat (The Lounge)
After=network.target
Wants=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/node /opt/coresapian/coreChat/server/index.js
WorkingDirectory=/opt/coresapian/coreChat
Environment=HOME=/opt/coresapian/coreChat
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF'

lxc_exec "systemctl daemon-reload"
echo "  coresapian-chat.service installed."

#-------------------------------------------------------------------------------
# STEP 3: Update Nginx config
#-------------------------------------------------------------------------------
echo ""
echo "[Step 3] Updating Nginx configuration..."

lxc_exec 'cat > /etc/nginx/sites-available/coresapian << EOFNGINX
# ==============================================================================
# CoreSapian.com - Full Nginx Configuration
# Runs on LXC 103 (192.168.0.148)
# Cloudflare handles TLS termination, so this is HTTP-only.
# ==============================================================================

# Rate limiting zone for API protection
limit_req_zone \$binary_remote_addr zone=chat:10m rate=30r/m;

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name coresapian.com www.coresapian.com game.coresapian.com coreserve.coresapian.com;

    root /var/www/coresapian;
    index index.html;

    # Godot web export - COOP/COEP headers for SharedArrayBuffer
    add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Cross-Origin-Embedder-Policy require-corp always;

    # Static site + Godot WASM export
    location / {
        try_files \$uri \$uri/ =404;
    }

    # Godot .wasm and .pck files - correct MIME types
    location ~* \.(wasm|pck)$ {
        types {
            application/wasm wasm;
            application/octet-stream pck;
        }
        default_type application/octet-stream;
    }

    # WebSocket proxy for world chat
    location /ws/world-chat {
        proxy_pass http://127.0.0.1:8765/ws/world-chat;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    # coreChat web client
    location /chat {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 600s;
        limit_req zone=chat burst=10 nodelay;
    }

    # coreChat Socket.IO
    location /socket.io/ {
        proxy_pass http://127.0.0.1:9000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 600s;
    }
}

# TCP stream proxy for Godot ENet multiplayer (port 7000)
# NOTE: This goes in the stream {} block in /etc/nginx/nginx.conf, NOT here.
# See the separate ENet proxy config below.
EOFNGINX'

lxc_exec "ln -sf /etc/nginx/sites-available/coresapian /etc/nginx/sites-enabled/coresapian"
lxc_exec "rm -f /etc/nginx/sites-enabled/default"

echo "  Nginx coresapian config updated."

#-------------------------------------------------------------------------------
# STEP 4: Add ENet TCP stream proxy to nginx.conf
#-------------------------------------------------------------------------------
echo ""
echo "[Step 4] Adding ENet TCP stream proxy..."

# Backup nginx.conf
lxc_exec "cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak"

# Add stream block if not present
lxc_exec "grep -q 'stream {' /etc/nginx/nginx.conf || cat >> /etc/nginx/nginx.conf << EOFSTREAM

# TCP stream proxy for Godot ENet multiplayer
stream {
    server {
        listen 7000;
        proxy_pass 127.0.0.1:7001;
        proxy_timeout 300s;
        proxy_connect_timeout 5s;
    }
}
EOFSTREAM"

echo "  ENet TCP proxy configured (7000 -> 7001)."

#-------------------------------------------------------------------------------
# STEP 5: Open UFW port 7000
#-------------------------------------------------------------------------------
echo ""
echo "[Step 5] Updating firewall rules..."
echo "  NOTE: No DDNS needed -- Cloudflare Tunnel handles DNS automatically."
echo "  The tunnel is outbound-only, so dynamic IP changes don't affect it."

lxc_exec "which ufw && ufw allow 7000/tcp comment 'Godot ENet multiplayer' || echo 'ufw not installed'"
lxc_exec "which ufw && ufw allow 9000/tcp comment 'coreChat internal' || echo 'ufw not installed'"

#-------------------------------------------------------------------------------
# STEP 6: Enable and start all services
#-------------------------------------------------------------------------------
echo ""
echo "[Step 6] Enabling services..."

lxc_exec "nginx -t && systemctl reload nginx || echo 'Nginx config error!'"
lxc_exec "systemctl enable coresapian-game.service 2>/dev/null; systemctl start coresapian-game.service 2>/dev/null || echo 'Game server not started (no binary yet)'"
lxc_exec "systemctl enable coresapian-chat.service 2>/dev/null; systemctl start coresapian-chat.service 2>/dev/null || echo 'coreChat not started (needs build)'"
lxc_exec "systemctl restart coresapian-world-chat.service"

#-------------------------------------------------------------------------------
# STEP 7: Deploy status page health check
#-------------------------------------------------------------------------------
echo ""
echo "[Step 7] Deploying status page health check..."

# Create scripts directory
lxc_exec "mkdir -p /opt/coresapian/scripts"

# Copy health check script
scp "${REPO_DIR}/scripts/health-check.py" "$PROXMOX_HOST:/tmp/health-check.py"
ssh "$PROXMOX_HOST" "pct push $CT_ID /tmp/health-check.py /opt/coresapian/scripts/health-check.py"
lxc_exec "chmod +x /opt/coresapian/scripts/health-check.py"
echo "  health-check.py deployed."

# Copy status page static files
lxc_exec "mkdir -p /var/www/coresapian/status"
scp "${REPO_DIR}/public/status/index.html" "$PROXMOX_HOST:/tmp/status-index.html"
ssh "$PROXMOX_HOST" "pct push $CT_ID /tmp/status-index.html /var/www/coresapian/status/index.html"

# Deploy initial status.json if not present (preserve existing on redeploys)
lxc_exec "test -f /var/www/coresapian/status/status.json || (cat > /var/www/coresapian/status/status.json << 'EOFSTATUS'
{
  \"last_checked\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
  \"overall\": \"operational\",
  \"services\": {
    \"coresapian\": {\"name\": \"Coresapian.com\", \"desc\": \"The Hearth-Fire — main website and game portal\", \"status\": \"operational\", \"uptime_90d\": 100.0, \"bars\": []},
    \"godot_game\": {\"name\": \"Godot Game Server\", \"desc\": \"The Great Hall — multiplayer temple server\", \"status\": \"operational\", \"uptime_90d\": 100.0, \"bars\": []},
    \"world_chat\": {\"name\": \"World Chat\", \"desc\": \"The Whispering Wind — global chat relay\", \"status\": \"operational\", \"uptime_90d\": 100.0, \"bars\": []},
    \"corechat\": {\"name\": \"coreChat\", \"desc\": \"The Scrying Pool — IRC web client\", \"status\": \"operational\", \"uptime_90d\": 100.0, \"bars\": []},
    \"starpark\": {\"name\": \"StarPark\", \"desc\": \"The Star-Forge — AI image generation\", \"status\": \"operational\", \"uptime_90d\": 100.0, \"bars\": []},
    \"plonk\": {\"name\": \"PLONK\", \"desc\": \"The All-Seer — visual geolocation\", \"status\": \"operational\", \"uptime_90d\": 100.0, \"bars\": []},
    \"njorun\": {\"name\": \"Njörun\", \"desc\": \"The World-Weaver — 3D scene generation\", \"status\": \"operational\", \"uptime_90d\": 100.0, \"bars\": []}
  },
  \"incidents\": []
}
EOFSTATUS
)"
echo "  Status page files deployed."

# Deploy systemd service and timer
lxc_exec 'cat > /etc/systemd/system/coresapian-health-check.service << EOF
[Unit]
Description=CoreSapian Status Page Health Check
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/coresapian/scripts/health-check.py
StandardOutput=journal
StandardError=journal
EOF'

lxc_exec 'cat > /etc/systemd/system/coresapian-health-check.timer << EOF
[Unit]
Description=Run CoreSapian health check every 5 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
AccuracySec=30s

[Install]
WantedBy=timers.target
EOF'

lxc_exec "systemctl daemon-reload"
lxc_exec "systemctl enable coresapian-health-check.timer"
lxc_exec "systemctl start coresapian-health-check.timer"
echo "  Health check timer enabled (runs every 5 minutes)."

# Run initial health check
lxc_exec "/usr/bin/python3 /opt/coresapian/scripts/health-check.py" || echo "  WARNING: Initial health check failed (services may not be running yet)"

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
echo "Services on LXC 103 (${CT_IP}):"
echo "  - Nginx          :80 (static + proxy)"
echo "  - World Chat     :8765 (WebSocket)"
echo "  - coreChat       :9000 (Socket.IO)"
echo "  - Godot Server   :7001 (ENet, proxied via nginx :7000)"
echo "  - Health Check   : systemd timer (every 5 min)"
echo "  - Cloudflare     : tunnel running"
echo ""
echo "Cloudflare Tunnel routes (managed via dashboard):"
echo "  coresapian.com      -> ${CT_IP}:80"
echo "  game.coresapian.com -> ${CT_IP}:80"
echo ""
echo "Next steps:"
echo "  1. Export Godot dedicated server: ./scripts/export_godot_all.sh"
echo "  2. Re-run this script to deploy the game server binary"
echo "  3. Build coreChat: cd /opt/coresapian/coreChat && npm run build"
echo "  4. Create coreChat users: sudo -u corechat thelounge add <name>"
echo ""
