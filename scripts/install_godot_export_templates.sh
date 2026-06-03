#!/usr/bin/env bash
set -euo pipefail

GODOT_RELEASE_TAG="4.6-stable"
TEMPLATE_VERSION_DIR="4.6.stable"
ARCHIVE_NAME="Godot_v${GODOT_RELEASE_TAG}_export_templates.tpz"
DOWNLOAD_URL="https://github.com/godotengine/godot/releases/download/${GODOT_RELEASE_TAG}/${ARCHIVE_NAME}"
TEMPLATE_ROOT="${HOME}/Library/Application Support/Godot/export_templates"
TARGET_DIR="${TEMPLATE_ROOT}/${TEMPLATE_VERSION_DIR}"
WORK_DIR="$(mktemp -d)"
ARCHIVE_PATH="${WORK_DIR}/${ARCHIVE_NAME}"
EXTRACT_DIR="${WORK_DIR}/extract"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$TEMPLATE_ROOT" "$EXTRACT_DIR"

if command -v gh >/dev/null 2>&1; then
  gh release download "$GODOT_RELEASE_TAG" --repo godotengine/godot --pattern "$ARCHIVE_NAME" --dir "$WORK_DIR" --clobber
elif command -v curl >/dev/null 2>&1; then
  curl -L "$DOWNLOAD_URL" -o "$ARCHIVE_PATH"
else
  echo "Either gh or curl is required to download Godot export templates." >&2
  exit 1
fi

unzip -qo "$ARCHIVE_PATH" -d "$EXTRACT_DIR"

if [ -e "$TARGET_DIR" ]; then
  rm -rf "$TARGET_DIR"
fi

mv "$EXTRACT_DIR/templates" "$TARGET_DIR"
printf 'Installed Godot export templates at %s\n' "$TARGET_DIR"
