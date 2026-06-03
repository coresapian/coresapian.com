#!/usr/bin/env bash
# ddns_godaddy.sh - Update GoDaddy DNS A records when public IP changes
#
# Usage:
#   GODADDY_KEY=xxx GODADDY_SECRET=yyy ./ddns_godaddy.sh [domain1 domain2 ...]
#
# Or set DOMAINS env var:
#   GODADDY_KEY=xxx GODADDY_SECRET=yyy DOMAINS="foo.com bar.com" ./ddns_godaddy.sh
#
# If no domains specified, defaults to:
#   coresapian.com datadelaurier.com daviddelaurier.com dwftf.com
#   syntheticmates.com title-map.com vision-vend.com lonnrune.com
#
# Designed for cron every 5 minutes:
#   */5 * * * * /opt/coresapian/scripts/ddns_godaddy.sh
#
# Required env vars:
#   GODADDY_KEY    - GoDaddy API key
#   GODADDY_SECRET - GoDaddy API secret

set -euo pipefail

# --- Config ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="/opt/coresapian/ddns"

# --- Load .env if available ---
ENV_FILE="${SCRIPT_DIR}/../.env"
if [[ -f "${ENV_FILE}" ]]; then
    set -a; source "${ENV_FILE}"; set +a
fi
LAST_IP_FILE="${STATE_DIR}/last_ip.txt"
LOG_FILE="${STATE_DIR}/ddns.log"
IP_PROVIDER="https://api.ipify.org"
GODADDY_API="https://api.godaddy.com/v1"
TTL=600
RECORD_NAME="@"   # root A record

# Default domains if none provided
DEFAULT_DOMAINS=(
    coresapian.com
    datadelaurier.com
    daviddelaurier.com
    dwftf.com
    syntheticmates.com
    title-map.com
    vision-vend.com
    syntheticmates.com
    lonnrune.com
)

# --- Validate required env vars ---
if [[ -z "${GODADDY_KEY:-}" || -z "${GODADDY_SECRET:-}" ]]; then
    echo "ERROR: GODADDY_KEY and GODADDY_SECRET env vars are required" >&2
    echo "Usage: GODADDY_KEY=xxx GODADDY_SECRET=yyy $0 [domains...]" >&2
    exit 1
fi

# --- Resolve domain list ---
if [[ $# -gt 0 ]]; then
    DOMAINS=("$@")
elif [[ -n "${DOMAINS:-}" ]]; then
    read -ra DOMAINS <<< "$DOMAINS"
else
    DOMAINS=("${DEFAULT_DOMAINS[@]}")
fi

# --- Ensure state directory exists ---
mkdir -p "$STATE_DIR"

# --- Logging ---
log() {
    local level="$1"; shift
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [${level}] $*"
    echo "$msg" | tee -a "$LOG_FILE"
}

# --- Get current public IP ---
CURRENT_IP=$(curl -sf --max-time 10 "$IP_PROVIDER" 2>/dev/null) || {
    log "ERROR" "Failed to fetch public IP from $IP_PROVIDER"
    exit 1
}

# Validate it looks like an IPv4 address
if [[ ! "$CURRENT_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    log "ERROR" "Invalid IP received: $CURRENT_IP"
    exit 1
fi

# --- Read last known IP ---
LAST_IP=""
if [[ -f "$LAST_IP_FILE" ]]; then
    LAST_IP=$(cat "$LAST_IP_FILE" 2>/dev/null | tr -d '[:space:]')
fi

# --- Skip if unchanged ---
if [[ "$CURRENT_IP" == "$LAST_IP" ]]; then
    log "INFO" "IP unchanged: $CURRENT_IP — no update needed"
    exit 0
fi

log "INFO" "IP changed: ${LAST_IP:-<none>} -> $CURRENT_IP"

# --- Update GoDaddy DNS for each domain ---
AUTH_HEADER="sso-key ${GODADDY_KEY}:${GODADDY_SECRET}"
UPDATED=0
FAILED=0

for domain in "${DOMAINS[@]}"; do
    log "INFO" "Updating A record for ${domain} (${RECORD_NAME}) -> ${CURRENT_IP}"

    HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
        -X PUT \
        -H "Authorization: ${AUTH_HEADER}" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -d "[{\"data\":\"${CURRENT_IP}\",\"ttl\":${TTL},\"name\":\"${RECORD_NAME}\",\"type\":\"A\"}]" \
        "${GODADDY_API}/domains/${domain}/records/A/${RECORD_NAME}" \
        2>/dev/null) || HTTP_CODE="000"

    if [[ "$HTTP_CODE" =~ ^20[0-9]$ ]]; then
        log "INFO" "  ${domain}: OK (HTTP ${HTTP_CODE})"
        ((UPDATED++)) || true
    else
        log "ERROR" "  ${domain}: FAILED (HTTP ${HTTP_CODE})"
        ((FAILED++)) || true
    fi
done

# --- Persist new IP only if at least one update succeeded ---
if [[ $UPDATED -gt 0 ]]; then
    echo "$CURRENT_IP" > "$LAST_IP_FILE"
    log "INFO" "Persisted IP ${CURRENT_IP} to ${LAST_IP_FILE} (${UPDATED} updated, ${FAILED} failed)"
else
    log "ERROR" "All updates failed — NOT persisting IP change"
    exit 1
fi

exit 0
