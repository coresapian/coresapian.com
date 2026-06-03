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
[ -n "${CT_IP:-}" ]            || missing="$missing  CT_IP\n"
[ -n "${GODOT_SERVER_DIR:-}" ] || missing="$missing  GODOT_SERVER_DIR\n"
[ -n "${GODOT_BIN:-}" ]        || missing="$missing  GODOT_BIN\n"
if [ -n "$missing" ]; then
  echo "ERROR: Missing required variables in .env:"
  printf "$missing"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════
# Coresapian Godot Dedicated Server - Deploy to Proxmox LXC CT 103
#
# Exports the Godot dedicated server binary and deploys it to CT 103.
# Installs the systemd service and opens the ENet port.
#
# Prerequisites:
#   - Godot 4.x editor installed (for export)
#   - SSH access to the CT (configure CT_IP in .env)
#   - Linux Dedicated Server export preset configured in Godot
#
# Usage:
#   cp .env.example .env   # edit values, then:
#   ./scripts/deploy_dedicated_server.sh
# ═══════════════════════════════════════════════════════════════════

VM_HOST="${1:-root@$CT_IP}"
VM_DIR="$GODOT_SERVER_DIR"
GODOT_BIN="$GODOT_BIN"

EXPORT_DIR="$PROJECT_DIR/exports"

echo "=== Coresapian Dedicated Server Deploy ==="
echo ""

# Step 1: Export the dedicated server binary
echo "[1/4] Exporting Linux dedicated server..."
mkdir -p "$EXPORT_DIR"

# Try to find Godot binary
if command -v "$GODOT_BIN" &>/dev/null; then
    GODOT_PATH="$(command -v "$GODOT_BIN")"
elif [ -f "/Applications/Godot.app/Contents/MacOS/Godot" ]; then
    GODOT_PATH="/Applications/Godot.app/Contents/MacOS/Godot"
elif [ -f "$HOME/Applications/Godot.app/Contents/MacOS/Godot" ]; then
    GODOT_PATH="$HOME/Applications/Godot.app/Contents/MacOS/Godot"
else
    echo "ERROR: Godot 4.6 binary not found."
    echo "Set GODOT_BIN env var or install Godot."
    echo "  export GODOT_BIN=/path/to/godot"
    exit 1
fi

echo "  Using Godot: $GODOT_PATH"
"$GODOT_PATH" --headless \
    --path "$PROJECT_DIR/godot" \
    --export-release "Linux Dedicated Server" \
    "$EXPORT_DIR/coresapian-server.x86_64"

echo "  Exported to: $EXPORT_DIR/coresapian-server.x86_64"
echo ""

# Step 2: Make binary executable and sync to VM
echo "[2/4] Syncing to VM ($VM_HOST)..."
chmod +x "$EXPORT_DIR/coresapian-server.x86_64"

# Create the target directory on the VM and sync
ssh "$VM_HOST" "mkdir -p $VM_DIR"
scp "$EXPORT_DIR/coresapian-server.x86_64" "$VM_HOST:$VM_DIR/coresapian-server.x86_64"
ssh "$VM_HOST" "chmod +x $VM_DIR/coresapian-server.x86_64"
echo "  Binary deployed to $VM_HOST:$VM_DIR/"
echo ""

# Step 3: Install systemd service
echo "[3/4] Installing systemd service..."
scp "$PROJECT_DIR/server/coresapian-game.service" "$VM_HOST:/tmp/coresapian-game.service"
ssh "$VM_HOST" "sudo mv /tmp/coresapian-game.service /etc/systemd/system/coresapian-game.service"
ssh "$VM_HOST" "sudo systemctl daemon-reload"
ssh "$VM_HOST" "sudo systemctl enable coresapian-game"
echo "  Service installed and enabled."
echo ""

# Step 4: Open ENet port in UFW
echo "[4/4] Configuring firewall (UFW)..."
ssh "$VM_HOST" "sudo ufw allow 7000/tcp comment 'Coresapian Godot ENet'"
echo "  Port 7000/tcp opened."
echo ""

echo "=== Deploy complete ==="
echo ""
echo "To start the server:"
echo "  ssh $VM_HOST 'sudo systemctl start coresapian-game'"
echo ""
echo "To check status:"
echo "  ssh $VM_HOST 'sudo systemctl status coresapian-game'"
echo ""
echo "To view logs:"
echo "  ssh $VM_HOST 'journalctl -u coresapian-game -f'"
echo ""
echo "To restart after updates:"
echo "  ssh $VM_HOST 'sudo systemctl restart coresapian-game'"
echo ""
echo "Server will listen on port 7000 (ENet)."
echo "Clients connect via: coresapian.com or VM_IP:7000"
