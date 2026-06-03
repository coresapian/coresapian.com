#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$ROOT_DIR/godot"
OUTPUT_DIR="$ROOT_DIR/public/game"
OUTPUT_HTML="$OUTPUT_DIR/index.html"
LEGACY_OUTPUT_DIR="$OUTPUT_DIR/build"
PRESET_NAME="Web"
TEMPLATE_DIR="$HOME/Library/Application Support/Godot/export_templates/4.6.stable"

if ! command -v godot >/dev/null 2>&1; then
  echo "godot is required on PATH to export the web build." >&2
  exit 1
fi

if [ ! -f "$TEMPLATE_DIR/web_release.zip" ]; then
  echo "Missing Godot export templates at $TEMPLATE_DIR" >&2
  echo "Run ./scripts/install_godot_export_templates.sh first." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
rm -rf "$LEGACY_OUTPUT_DIR"

godot --headless --path "$PROJECT_DIR" --export-release "$PRESET_NAME" "$OUTPUT_HTML"
