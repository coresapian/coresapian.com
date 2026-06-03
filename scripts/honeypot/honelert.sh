#!/bin/bash
# ─────────────────────────────────────────────────────────
# honelert.sh — Honeypot alert dispatcher for coresapian.com
# Install to: /usr/local/bin/honelert.sh
#
# Triggered by:
#   1. Fail2Ban action (recommended — calls this on ban)
#   2. inotifywait on /var/log/nginx/honeypot-access.log
#   3. Cron every minute (tail -n 1, compare with last-seen marker)
#
# Usage: honelert.sh "<log line from nginx>"
#   e.g.: honelert.sh '192.168.1.1 - - [02/May/2026:21:30:00 +0000] "GET /wp-admin HTTP/1.1" 200 123'
# ─────────────────────────────────────────────────────────

set -euo pipefail

HONEYPOT_LOG="/var/log/honeypot-incidents.log"
ALERT_EMAIL="${HONELERT_EMAIL:-coresapian@gmail.com}"

# ── Parse input (either $1 as raw log line, or tail the log) ──
if [ -n "${1:-}" ]; then
    LINE="$1"
else
    LINE=$(tail -n 1 /var/log/nginx/honeypot-access.log 2>/dev/null)
fi

[ -z "$LINE" ] && exit 0

ATTACKER_IP=$(echo "$LINE" | awk '{print $1}')
TIMESTAMP=$(echo "$LINE" | grep -oP '\[\K[^\]]+' || date '+%d/%b/%Y:%H:%M:%S %z')
PATH_HIT=$(echo "$LINE" | grep -oP '(?<="(?:GET|POST|HEAD|PUT|DELETE|OPTIONS|PATCH) )\S+')
METHOD=$(echo "$LINE" | grep -oP '(?<=")(?:GET|POST|HEAD|PUT|DELETE|OPTIONS|PATCH)' || echo "UNKNOWN")
USER_AGENT=$(echo "$LINE" | grep -oP '" "\K[^"]+(?="$)' || echo "unknown")

# ── Log incident locally ──
mkdir -p "$(dirname "$HONEYPOT_LOG")"
echo "$(date +%Y-%m-%d_%H:%M:%S) | IP: $ATTACKER_IP | Method: $METHOD | Path: $PATH_HIT | UA: $USER_AGENT | Raw: $LINE" >> "$HONEYPOT_LOG"

# ── Email alert ──
if [ -n "$ALERT_EMAIL" ]; then
    {
        echo "Subject: [HONEYPOT] Alert on coresapian.com — $ATTACKER_IP"
        echo "To: $ALERT_EMAIL"
        echo "Content-Type: text/plain; charset=UTF-8"
        echo ""
        echo "==========================================="
        echo "  HONEYPOT TRIGGERED on coresapian.com"
        echo "==========================================="
        echo ""
        echo "  IP:       $ATTACKER_IP"
        echo "  Method:   $METHOD"
        echo "  Path:     $PATH_HIT"
        echo "  Time:     $TIMESTAMP"
        echo "  UA:       $USER_AGENT"
        echo "  Action:   IP banned for 7 days (Fail2Ban)"
        echo ""
    } | sendmail "$ALERT_EMAIL"
fi

# ── Reverse DNS lookup for context (best-effort) ──
RDNS=$(dig +short -x "$ATTACKER_IP" 2>/dev/null | head -1 || echo "no-rdns")

# ── GeoIP lookup if geoiplookup is installed ──
GEO=""
if command -v geoiplookup &>/dev/null; then
    GEO=$(geoiplookup "$ATTACKER_IP" 2>/dev/null | head -1 || echo "")
fi

# ── Append enrichment to incident log ──
echo "  └─ rDNS: $RDNS | Geo: $GEO" >> "$HONEYPOT_LOG"

# Report to Heimdall collector
curl -s -X POST "http://192.168.0.150:9090/api/incident" \
  -H "Content-Type: application/json" \
  -d '{"site":"coresapian.com","ip":"'"$ATTACKER_IP"'","method":"'"$METHOD"'","path":"'"$PATH_HIT"'","user_agent":"'"$USER_AGENT"'","timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","action":"banned"}' >/dev/null 2>&1 || true

exit 0
