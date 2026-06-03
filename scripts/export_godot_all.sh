#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$ROOT_DIR/godot"
TEMPLATE_DIR="$HOME/Library/Application Support/Godot/export_templates/4.6.stable"

if ! command -v godot >/dev/null 2>&1; then
  echo "godot is required on PATH to export." >&2
  exit 1
fi

if [ ! -f "$TEMPLATE_DIR/web_release.zip" ]; then
  echo "Missing Godot export templates at $TEMPLATE_DIR" >&2
  echo "Run ./scripts/install_godot_export_templates.sh first." >&2
  exit 1
fi

# --- Export Web (WASM client) ---
WEB_OUTPUT="$ROOT_DIR/public/game"
mkdir -p "$WEB_OUTPUT"
echo "Exporting Web (WASM)..."
godot --headless --path "$PROJECT_DIR" --export-release "Web" "$WEB_OUTPUT/index.html"
echo "  -> $WEB_OUTPUT/"

# --- Export Linux Dedicated Server ---
SERVER_OUTPUT="$ROOT_DIR/exports"
mkdir -p "$SERVER_OUTPUT"
echo "Exporting Linux Dedicated Server..."
godot --headless --path "$PROJECT_DIR" --export-release "Linux Dedicated Server" "$SERVER_OUTPUT/coresapian-server.x86_64"
chmod +x "$SERVER_OUTPUT/coresapian-server.x86_64"
echo "  -> $SERVER_OUTPUT/coresapian-server.x86_64"

echo ""
echo "Exports complete. Run scripts/deploy-coresapian.sh to deploy."
