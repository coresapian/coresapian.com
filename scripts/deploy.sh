#!/usr/bin/env bash
#
# Coresapian Auto-Versioning Deploy Script v3.0
#
# What it does:
#   1. Hashes all versioned assets → short content-based cache-bust strings
#   2. Copies .pck and .wasm to content-hashed filenames on the server
#      (e.g. index-a1b2c3d4.pck) so browsers ALWAYS fetch fresh on deploy
#   3. Patches COPIES of HTML files (never mutates source) with hashes
#   4. SCPs everything to LXC 103, reloads nginx, verifies
#
# v3.0 changes:
#   • Root index.html is the sole entry point — no separate /game/ page
#   • Removed browser-overlay.js (overlay system removed)
#
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="root@192.168.0.148"
REMOTE_ROOT="/var/www/coresapian"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log() { echo -e "${CYAN}▶${NC} $*"; }
ok()  { echo -e "${GREEN}✓${NC} $*"; }
warn(){ echo -e "${YELLOW}⚠${NC} $*"; }
err() { echo -e "${RED}✗${NC} $*" >&2; }

# ─── 1. Compute content hashes ────────────────────────────────────
log "Computing content hashes..."

hash_file() {
    if [[ -f "$1" ]]; then
        shasum -a 256 "$1" | cut -c1-8
    else
        echo "MISSING"
    fi
}

size_file() {
    if [[ -f "$1" ]]; then
        stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null
    else
        echo "0"
    fi
}

CSS_HASH=$(hash_file "$PROJECT_ROOT/public/game/game-shell.css")
JS_HASH=$(hash_file "$PROJECT_ROOT/public/game/game-shell.js")
ENGINE_HASH=$(hash_file "$PROJECT_ROOT/public/game/index.js")
AUDIO_HASH=$(hash_file "$PROJECT_ROOT/assets/audio/orchastra-cinematic-001.mp3")
PCK_HASH=$(hash_file "$PROJECT_ROOT/public/game/index.pck")
WASM_HASH=$(hash_file "$PROJECT_ROOT/public/game/index.wasm")
PCK_SIZE=$(size_file "$PROJECT_ROOT/public/game/index.pck")
WASM_SIZE=$(size_file "$PROJECT_ROOT/public/game/index.wasm")

# Build version string: YYYYMMDD-HHMM (UTC) — changes every deploy
BUILD_VERSION="v$(TZ=UTC date '+%Y%m%d-%H%M')"

# The executable base name uses the WASM hash (engine loads ${executable}.wasm)
# mainPack is set separately with the PCK hash (they have DIFFERENT content hashes)
EXEC_ROOT="/game/index-${WASM_HASH}"
MAINPACK_ROOT="/game/index-${PCK_HASH}.pck"

ok "CSS       → v=$CSS_HASH"
ok "Shell JS  → v=$JS_HASH"
ok "Engine JS → v=$ENGINE_HASH"
ok "Audio     → v=$AUDIO_HASH"
ok "PCK hash  → $PCK_HASH ($PCK_SIZE bytes)"
ok "WASM hash → $WASM_HASH ($WASM_SIZE bytes)"
ok "Exec (wasm) → $EXEC_ROOT"
ok "MainPack    → $MAINPACK_ROOT"
ok "Version     → $BUILD_VERSION"

# ─── 2. Prepare staging directory ──────────────────────────────────
STAGING="$PROJECT_ROOT/.deploy-staging"
rm -rf "$STAGING"
mkdir -p "$STAGING"

log "Staging HTML files (patching copies, not source)..."

# Copy root HTML to staging — patches apply to copy only
cp "$PROJECT_ROOT/public/index.html" "$STAGING/root-index.html"

# ─── 3. Patch HTML copy ───────────────────────────────────────────
log "Patching HTML with content hashes..."

patch_html() {
    local file="$1"
    local css_path="$2"       # absolute path to game-shell.css
    local js_path="$3"        # absolute path to game-shell.js
    local engine_path="$4"    # absolute path to index.js
    local audio_path="$5"     # absolute path to audio
    local exec_value="$6"     # executable path for Godot config (WASM base)
    local mainpack_value="$7" # mainPack path for Godot config (PCK path)

    # Remove ALL old version strings and old hashed filenames
    sed -i '' -E 's/\?v=[a-zA-Z0-9_-]+//g' "$file"
    sed -i '' -E 's|index-[a-f0-9]{8}\.|index.|g' "$file"

    # Add content-hash versions for static assets
    sed -i '' "s|${css_path}|${css_path}?v=${CSS_HASH}|g" "$file"
    sed -i '' "s|${js_path}|${js_path}?v=${JS_HASH}|g" "$file"
    sed -i '' "s|${engine_path}|${engine_path}?v=${ENGINE_HASH}|g" "$file"
    sed -i '' "s|${audio_path}|${audio_path}?v=${AUDIO_HASH}|g" "$file"

    # Replace executable + add mainPack (macOS sed can't do \n in replacement, use python)
    sed -i '' -E '/"mainPack"/d' "$file"
    python3 -c "
import re, sys
f = sys.argv[1]
exec_val = sys.argv[2]
pack_val = sys.argv[3]
with open(f) as fh: txt = fh.read()
txt = re.sub(r'\"executable\":\s*\"[^\"]*\"', '\"executable\": \"' + exec_val + '\",\n        \"mainPack\": \"' + pack_val + '\"', txt)
with open(f, 'w') as fh: fh.write(txt)
" "$file" "$exec_value" "$mainpack_value"

    # Replace fileSizes keys with correct hashed names and sizes
    sed -i '' -E "s|\"[/a-zA-Z]*index[a-zA-Z0-9.-]*\\.wasm\\\":\s*[0-9]+|\"${exec_value}.wasm\":${WASM_SIZE}|g" "$file"
    sed -i '' -E "s|\"[/a-zA-Z]*index[a-zA-Z0-9.-]*\\.pck\\\":\s*[0-9]+|\"${mainpack_value}\":${PCK_SIZE}|g" "$file"

    # Stamp the build version into the loader
    sed -i '' "s|data-version=\"[^\"]*\"|data-version=\"${BUILD_VERSION}\"|g" "$file"

    # ── Verify patches actually applied ──
    local errors=0
    if ! grep -q '"executable"' "$file"; then
        echo "  ✗ FAIL: executable not found in $file"; errors=$((errors + 1))
    fi
    if ! grep -q '"mainPack"' "$file"; then
        echo "  ✗ FAIL: mainPack not found in $file"; errors=$((errors + 1))
    fi
    if ! grep -q "?v=${CSS_HASH}" "$file"; then
        echo "  ✗ FAIL: CSS version hash missing in $file"; errors=$((errors + 1))
    fi
    if ! grep -q "?v=${JS_HASH}" "$file"; then
        echo "  ✗ FAIL: JS version hash missing in $file"; errors=$((errors + 1))
    fi
    if [ $errors -gt 0 ]; then
        err "HTML patching failed with $errors errors — aborting deploy"
        rm -rf "$STAGING"
        exit 1
    fi
}

# --- root landing (the ONLY URL users visit) ---
patch_html "$STAGING/root-index.html" \
    "/game/game-shell.css" \
    "/game/game-shell.js" \
    "/game/index.js" \
    "/orchastra-cinematic-001.mp3" \
    "$EXEC_ROOT" \
    "$MAINPACK_ROOT"
ok "Patched index.html (staged)"

# ─── 4. Deploy to LXC 103 ──────────────────────────────────────────
log "Deploying to $REMOTE..."

# HTML + shell files (from staging, not source)
scp -q "$STAGING/root-index.html"            "$REMOTE:$REMOTE_ROOT/index.html"
scp -q "$PROJECT_ROOT/public/game/game-shell.css" "$REMOTE:$REMOTE_ROOT/game/game-shell.css"
scp -q "$PROJECT_ROOT/public/game/game-shell.js"  "$REMOTE:$REMOTE_ROOT/game/game-shell.js"
scp -q "$PROJECT_ROOT/public/game/index.js"       "$REMOTE:$REMOTE_ROOT/game/index.js"
ok "HTML + shell deployed"

# Audio
scp -q "$PROJECT_ROOT/assets/audio/orchastra-cinematic-001.mp3" \
    "$REMOTE:$REMOTE_ROOT/orchastra-cinematic-001.mp3"
ok "Audio deployed"

# ─── 5. Deploy hashed .pck and .wasm ────────────────────────────────
log "Deploying hashed engine assets..."

# Upload the base files
scp -q "$PROJECT_ROOT/public/game/index.pck"  "$REMOTE:$REMOTE_ROOT/game/index.pck"
scp -q "$PROJECT_ROOT/public/game/index.wasm" "$REMOTE:$REMOTE_ROOT/game/index.wasm"

# Upload threaded web worker (needed for GDExtension support)
if [[ -f "$PROJECT_ROOT/public/game/index.side.wasm" ]]; then
    scp -q "$PROJECT_ROOT/public/game/index.side.wasm" "$REMOTE:$REMOTE_ROOT/game/index.side.wasm"
fi

# Upload GDExtension wasm binaries
for ext_wasm in "$PROJECT_ROOT/public/game/"lib*.web.*.wasm; do
    if [[ -f "$ext_wasm" ]]; then
        scp -q "$ext_wasm" "$REMOTE:$REMOTE_ROOT/game/$(basename "$ext_wasm")"
    fi
done

# Upload audio worklet files (Godot loads these as \${executable}.audio.worklet.js etc.)
scp -q "$PROJECT_ROOT/public/game/index.audio.position.worklet.js" \
    "$REMOTE:$REMOTE_ROOT/game/index.audio.position.worklet.js"
scp -q "$PROJECT_ROOT/public/game/index.audio.worklet.js" \
    "$REMOTE:$REMOTE_ROOT/game/index.audio.worklet.js"

# Create content-hashed copies on the server (also keep the base name as fallback)
ssh "$REMOTE" bash -s <<REMOTE_SETUP
set -e
cd $REMOTE_ROOT/game

# Copy to hashed names
cp index.pck  "index-${PCK_HASH}.pck"
cp index.wasm "index-${WASM_HASH}.wasm"

# Copy worklet files with hashed prefix (Godot constructs URLs like index-HASH.audio.worklet.js)
cp index.audio.position.worklet.js "index-${WASM_HASH}.audio.position.worklet.js"
cp index.audio.worklet.js          "index-${WASM_HASH}.audio.worklet.js"

# Copy side.wasm with hashed prefix (threaded worker — Godot constructs \${executable}.side.wasm)
if [ -f index.side.wasm ]; then
    cp index.side.wasm "index-${WASM_HASH}.side.wasm"
fi

# Clean up old hashed files (keep current + base only)
for f in index-*.pck; do
    [ "\$f" = "index-${PCK_HASH}.pck" ] && continue
    rm -f "\$f"
done
for f in index-*.wasm; do
    [ "\$f" = "index-${WASM_HASH}.wasm" ] && continue
    [ "\$f" = "index-${WASM_HASH}.side.wasm" ] && continue
    case "\$f" in *.side.wasm) continue ;; esac
    case "\$f" in lib*.wasm) continue ;; esac
    rm -f "\$f"
done
for f in index-*.audio.position.worklet.js; do
    [ "\$f" = "index-${WASM_HASH}.audio.position.worklet.js" ] || [ "\$f" = "index.audio.position.worklet.js" ] && continue
    rm -f "\$f"
done
for f in index-*.audio.worklet.js; do
    [ "\$f" = "index-${WASM_HASH}.audio.worklet.js" ] || [ "\$f" = "index.audio.worklet.js" ] && continue
    rm -f "\$f"
done

# Fix permissions — directories must be 755, files 644
find $REMOTE_ROOT -type d -exec chmod 755 {} \;
find $REMOTE_ROOT -type f -exec chmod 644 {} \;
chown -R www-data:www-data $REMOTE_ROOT/

echo "  Hashed files:"
ls -la index-*.pck index-*.wasm
REMOTE_SETUP
ok "Hashed .pck and .wasm deployed"

# ─── 6. Reload nginx ───────────────────────────────────────────────
log "Reloading nginx..."
ssh "$REMOTE" "nginx -t 2>&1 && systemctl reload nginx"
ok "nginx reloaded"

# ─── 7. Verify ─────────────────────────────────────────────────────
log "Verifying deployment..."

ssh "$REMOTE" bash -s <<VERIFY
set -e
echo "  PCK:  \$(stat -c%s /var/www/coresapian/game/index.pck) bytes"
echo "  WASM: \$(stat -c%s /var/www/coresapian/game/index.wasm) bytes"
echo "  Hashed PCK exists:  \$(test -f /var/www/coresapian/game/index-${PCK_HASH}.pck && echo YES || echo NO)"
echo "  Hashed WASM exists: \$(test -f /var/www/coresapian/game/index-${WASM_HASH}.wasm && echo YES || echo NO)"
echo "  Services:"
for svc in nginx cloudflared coresapian-anonymous-chat coresapian-mp; do
    status=\$(systemctl is-active "\$svc" 2>/dev/null || echo "inactive")
    echo "    \$svc: \$status"
done
echo "  Executable in root HTML:"
    grep -o '"executable"[^,]*' /var/www/coresapian/index.html
    echo "  Build version:"
    grep -o 'data-version="[^"]*"' /var/www/coresapian/index.html
    echo "  Hash versions in root HTML:"
grep -oE 'v=[a-f0-9]{8}' /var/www/coresapian/index.html | sort -u
VERIFY

# ─── 8. Clean up staging ───────────────────────────────────────────
rm -rf "$STAGING"

ok "Deploy complete!"
echo ""
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Coresapian v3.0 deployed — all caches busted ${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo ""
echo "  URL: https://coresapian.com/"
echo "  .pck  → /game/index-${PCK_HASH}.pck"
echo "  .wasm → /game/index-${WASM_HASH}.wasm"
echo "  Browser will fetch fresh — no hard refresh needed."
