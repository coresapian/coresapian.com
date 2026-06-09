#!/usr/bin/env python3
"""Check Coresapian Inc services and write status.json for the status dashboard."""

import json, urllib.request, urllib.error, os, sys, ssl
from datetime import datetime, timezone

SERVICES = {
    "coresapian": {
        "url": "https://coresapian.com/",
        "name": "Coresapian.com",
        "desc": "The Hearth-Fire — main website and game portal"
    },
    "godot_game": {
        "url": "https://coresapian.com/",
        "name": "Godot Game Server",
        "desc": "The Great Hall — multiplayer temple server"
    },
    "anonymous_chat": {
        "url": "https://coresapian.com/ws/chat",
        "name": "Anonymous Chat",
        "desc": "The Whispering Wind — global chat relay"
    },
    "multiplayer_orbs": {
        "url": "http://localhost:8082/health",
        "name": "Multiplayer Orbs",
        "desc": "The Astral Path — real-time player position relay"
    },
    "starpark": {
        "url": "https://starpark.app/",
        "name": "StarPark",
        "desc": "The Star-Forge — AI image generation"
    },
}

STATUS_FILE = "/var/lib/coresapian/status.json"
HISTORY_FILE = "/var/lib/coresapian/history.json"

# Ensure status directory exists
os.makedirs(os.path.dirname(STATUS_FILE), exist_ok=True)

SSL_CONTEXT = ssl.create_default_context()
SSL_CONTEXT.check_hostname = True

def check_url(url, timeout=10):
    """Return True if URL returns HTTP < 500."""
    try:
        req = urllib.request.Request(url, method="HEAD")
        resp = urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT)
        return resp.status < 500
    except Exception:
        return False

def main():
    # Load existing history
    history = {}
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE) as f:
                history = json.load(f)
        except Exception:
            history = {}

    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    statuses = {}
    all_up = True
    any_down = False

    for svc_id, svc in SERVICES.items():
        up = check_url(svc["url"])
        statuses[svc_id] = "operational" if up else "down"
        if not up:
            all_up = False
            any_down = True

        # Update daily history
        if svc_id not in history:
            history[svc_id] = {}
        if today not in history[svc_id]:
            history[svc_id][today] = True
        history[svc_id][today] = history[svc_id][today] and up

    # Handle services not directly HTTP-checked (plonk, njorun)
    # They aren't externally accessible; carry forward their last status
    for extra in ("plonk", "njorun"):
        if extra not in history:
            history[extra] = {}
        if today not in history[extra]:
            history[extra][today] = True

    overall = "operational" if all_up else ("major_outage" if any_down else "degraded")

    # Load existing status.json to preserve incident data
    output = {
        "last_checked": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "overall": overall,
        "services": {},
        "incidents": []
    }

    # Load existing incidents
    if os.path.exists(STATUS_FILE):
        try:
            with open(STATUS_FILE) as f:
                existing = json.load(f)
                output["incidents"] = existing.get("incidents", [])
        except Exception:
            pass

    # Build service data
    all_service_ids = list(SERVICES.keys()) + ["plonk", "njorun"]
    service_meta = {
        "coresapian":      SERVICES["coresapian"],
        "godot_game":      SERVICES["godot_game"],
        "anonymous_chat":  SERVICES["anonymous_chat"],
        "starpark":        SERVICES["starpark"],
        "plonk":           {"name": "PLONK", "desc": "The All-Seer — visual geolocation"},
        "njorun":          {"name": "Njörun", "desc": "The World-Weaver — 3D scene generation"},
    }

    for svc_id in all_service_ids:
        days = sorted(history.get(svc_id, {}).keys())[-90:]
        bars = [{"date": d, "up": history[svc_id][d]} for d in days]
        up_count = sum(1 for b in bars if b["up"])
        total = len(bars) if bars else 1
        uptime_pct = (up_count / total) * 100

        output["services"][svc_id] = {
            "name": service_meta[svc_id]["name"],
            "desc": service_meta[svc_id]["desc"],
            "status": statuses.get(svc_id, "operational"),
            "uptime_90d": round(uptime_pct, 2),
            "bars": bars
        }

    # Write atomically
    tmp = STATUS_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(output, f)
    os.rename(tmp, STATUS_FILE)

    # Prune old history (keep 120 days)
    for svc_id in history:
        days = sorted(history[svc_id].keys())
        for old in days[:-120]:
            del history[svc_id][old]

    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f)

if __name__ == "__main__":
    main()
