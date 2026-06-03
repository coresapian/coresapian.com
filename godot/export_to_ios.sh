#!/bin/bash
# Export Godot project as PCK file for iOS integration.
# Usage: ./export_to_ios.sh
#
# Prerequisites:
#   - Godot 4.6+ accessible via `godot`, in /Applications, or ~/Downloads
#   - iOS export preset configured in export_presets.cfg

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Locate Godot binary: prefer GODOT_BIN env var, then PATH, then common macOS locations
if [ -n "${GODOT_BIN:-}" ]; then
    : # Use provided GODOT_BIN
elif command -v godot &>/dev/null; then
    GODOT_BIN="$(command -v godot)"
elif [ -x "/Applications/Godot.app/Contents/MacOS/Godot" ]; then
    GODOT_BIN="/Applications/Godot.app/Contents/MacOS/Godot"
elif [ -x "/Users/$(whoami)/Downloads/Godot.app/Contents/MacOS/Godot" ]; then
    GODOT_BIN="/Users/$(whoami)/Downloads/Godot.app/Contents/MacOS/Godot"
else
    echo "Error: Godot not found. Set GODOT_BIN or install Godot."
    exit 1
fi

IOS_DIR="$SCRIPT_DIR/../ios"
PCK_OUTPUT="$IOS_DIR/main.pck"

echo "Exporting Godot project to PCK..."
"$GODOT_BIN" --headless --path "$SCRIPT_DIR" --export-pack "iOS" "$PCK_OUTPUT"
EXPORT_STATUS=$?

if [ $EXPORT_STATUS -eq 0 ]; then
    echo "Success! PCK exported to: $PCK_OUTPUT"
    echo "Add main.pck to your Xcode target if not already added."
else
    echo "Export failed (exit code: $EXPORT_STATUS). Make sure Godot export templates are installed."
    echo "Open Godot > Editor > Manage Export Templates > Download"
    exit 1
fi
