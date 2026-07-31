#!/usr/bin/env bash
# ============================================================================
# CORESAPIAN / dwftf.com — deploy script
# Builds the client, packages source+dist, pushes to LXC 107, restarts service.
# Usage: bash scripts/deploy.sh [--build-only] [--no-build]
# ============================================================================
set -euo pipefail

PROJ_DIR="/Users/core/coresapian_inc/Codebases/Alfheim/coresapian/3drpg/app"
REMOTE_HOST="root@192.168.0.10"
LXC_ID="${LXC_ID:-107}"
REMOTE_ROOT="/opt/coresapian"
SERVICE_NAME="coresapian"
BUILD_VERSION="${BUILD_VERSION:-$(date -u +%Y%m%d-%H%M%S)}"

cd "$PROJ_DIR"

# --- parse args ---
BUILD_ONLY=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --build-only) BUILD_ONLY=1 ;;
    --no-build)   SKIP_BUILD=1 ;;
    *) echo "Unknown arg: $arg"; exit 2 ;;
  esac
done

echo "▸ dwftf.com deploy (LXC $LXC_ID, version $BUILD_VERSION)"

# --- 1. Clean install if lockfile is stale or node_modules missing ---
if [ ! -d node_modules ] || [ ! -f package-lock.json ]; then
  echo "▸ fresh npm install (registry.npmjs.org)"
  npm install --registry=https://registry.npmjs.org --no-audit --no-fund
fi

# --- 2. Build ---
if [ "$SKIP_BUILD" -eq 0 ]; then
  echo "▸ npm run build"
  BUILD_VERSION="$BUILD_VERSION" npm run build
fi

if [ "$BUILD_ONLY" -eq 1 ]; then
  echo "✓ build-only done"
  exit 0
fi

# --- 3. Package source + built artifacts (exclude node_modules, .git) ---
# NOTE: do NOT add `--exclude='dist'` — it would also strip the explicit `dist/`
# arg below and ship a build with no frontend. (Past deploys hit this regression.)
STAGING="/tmp/coresapian-deploy.tar.gz"
echo "▸ packaging source + dist"
COPYFILE_DISABLE=1 tar czf "$STAGING" --no-xattrs \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='*.log' \
  package.json package-lock.json \
  tsconfig.json tsconfig.server.json tsconfig.node.json tsconfig.app.json \
  api/ contracts/ db/ \
  vite.config.ts \
  drizzle.config.ts \
  index.html \
  public/ \
  dist/

# --- 4. Push to Proxmox host, then into LXC ---
echo "▸ scp to Proxmox host"
scp -q "$STAGING" "$REMOTE_HOST:/tmp/coresapian-deploy.tar.gz"
rm -f "$STAGING"

echo "▸ pct push into LXC $LXC_ID"
ssh "$REMOTE_HOST" "pct push $LXC_ID /tmp/coresapian-deploy.tar.gz /tmp/coresapian-deploy.tar.gz"

# --- 5. Extract, npm ci prod deps, restart ---
# The heredoc is quoted (<<'REMOTE') so every $ inside resolves on the remote host.
echo "▸ extracting + installing prod deps + restarting service"
ssh "$REMOTE_HOST" bash -s <<'REMOTE'
set -euo pipefail
LXC="107"
ROOT="/opt/coresapian"
SVC="coresapian"

# Preserve .env from prior deploy (exists after first deploy)
pct exec "$LXC" -- bash -c 'cp "$1/.env" /tmp/.env.preserve 2>/dev/null || true' bash "$ROOT"

# Nuke and recreate (tar extract is additive; avoid stale chunks)
pct exec "$LXC" -- bash -c 'rm -rf "$1" && mkdir -p "$1"' bash "$ROOT"

# Extract the new build
pct exec "$LXC" -- bash -c 'cd "$1" && tar xzf /tmp/coresapian-deploy.tar.gz --no-xattrs && rm /tmp/coresapian-deploy.tar.gz' bash "$ROOT"

# Restore .env (server does not need BUILD_VERSION)
pct exec "$LXC" -- bash -c 'cp /tmp/.env.preserve "$1/.env" 2>/dev/null || true; rm -f /tmp/.env.preserve' bash "$ROOT"

# Install prod deps
pct exec "$LXC" -- bash -c 'cd "$1" && npm ci --omit=dev --no-audit --no-fund --registry=https://registry.npmjs.org' bash "$ROOT"

# Restart service — fail loudly if it does not come up
pct exec "$LXC" -- systemctl restart "$SVC"
sleep 3
if ! pct exec "$LXC" -- systemctl is-active --quiet "$SVC"; then
  echo "✗ service $SVC failed to start; recent logs:" >&2
  pct exec "$LXC" -- bash -c 'tail -n 40 /var/log/"$1".log' bash "$SVC" >&2 || true
  exit 1
fi
echo "✓ $SVC active"
REMOTE

# --- 6. Verify ---
echo "▸ verifying live site"
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' https://dwftf.com/)
echo "  homepage: $HTTP_CODE"
HOMEPAGE_VERSION=$(curl -s https://dwftf.com/ | grep -o 'meta name="build-version" content="[^"]*"' || true)
echo "  homepage meta: $HOMEPAGE_VERSION"
STATUS=$(curl -s https://dwftf.com/api/status)
echo "  /api/status: $STATUS"
STATIC_VERSION=$(curl -s https://dwftf.com/version.json)
echo "  /version.json: $STATIC_VERSION"

if [ "$HTTP_CODE" != "200" ]; then
  echo "✗ deploy verification failed (HTTP $HTTP_CODE)" >&2
  exit 1
fi
# Confirm the HTML index also carries the same version stamp.
if ! echo "$HOMEPAGE_VERSION" | grep -q "content=\"$BUILD_VERSION\""; then
  echo "✗ HTML version mismatch — index.html meta tag did not pick up BUILD_VERSION=$BUILD_VERSION" >&2
  exit 1
fi
# Confirm the API is healthy (no server-side version stamp needed).
if ! echo "$STATUS" | tr -d '[:space:]' | grep -q "\"ok\":true"; then
  echo "✗ /api/status did not return ok=true" >&2
  exit 1
fi
# Confirm the static dist also carries the same version stamp.
if ! echo "$STATIC_VERSION" | tr -d '[:space:]' | grep -q "\"version\":\"$BUILD_VERSION\""; then
  echo "✗ static version mismatch — dist/version.json did not pick up BUILD_VERSION=$BUILD_VERSION" >&2
  echo "  (this usually means the frontend build was stale or not included in the tarball)" >&2
  exit 1
fi
echo "✓ deploy complete — https://dwftf.com/ live (version $BUILD_VERSION)"
