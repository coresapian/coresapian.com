#!/usr/bin/env bash
# ============================================================================
# CoreSapian.com — Local Development Manager
#
# Start, stop, and restart individual services or all at once.
# Each service runs in the background with PID tracking.
#
# Usage:
#   ./scripts/dev.sh start          # Start all services
#   ./scripts/dev.sh start chat     # Start only world-chat
#   ./scripts/dev.sh stop           # Stop all services
#   ./scripts/dev.sh stop relay     # Stop only enet-relay
#   ./scripts/dev.sh restart all    # Restart everything
#   ./scripts/dev.sh status         # Show running services
#   ./scripts/dev.sh logs <name>    # Tail a service's log
#
# Available services: world-chat, enet-relay, corechat, godot-server
#
# Requires bash 4+ (associative arrays). macOS users:
#   brew install bash && /opt/homebrew/bin/bash scripts/dev.sh status
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_DIR="$PROJECT_DIR/.dev-pids"
LOG_DIR="$PROJECT_DIR/.dev-logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

# Source .env if available
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a; source "$PROJECT_DIR/.env"; set +a
fi

ALL_SERVICES="world-chat enet-relay corechat godot-server"

# Service descriptions (looked up by name)
svc_desc() {
    case "$1" in
        world-chat)   echo "Python WebSocket world chat server (:8765)" ;;
        enet-relay)   echo "Python ENet<->WebSocket relay (:7000 -> :7001)" ;;
        corechat)     echo "Node.js IRC web client (:9000)" ;;
        godot-server) echo "Godot 4 headless dedicated server (:7001)" ;;
    esac
}

# Service start commands
svc_cmd() {
    case "$1" in
        world-chat)   echo "python3 $PROJECT_DIR/server/world_chat_server.py --host 0.0.0.0 --port 8765 --api-keys ${CORE_CHAT_API_KEYS:-dev-key-123}" ;;
        enet-relay)   echo "python3 $PROJECT_DIR/server/enet_ws_relay.py" ;;
        corechat)     echo "node $PROJECT_DIR/coreChat/server/index.js" ;;
        godot-server) echo "$PROJECT_DIR/exports/coresapian-server.x86_64 --headless" ;;
    esac
}

# Service dependency (returns empty if none)
svc_dep() {
    case "$1" in
        enet-relay) echo "godot-server" ;;
    esac
}

# ── Helpers ────────────────────────────────────────────────────────────
is_running() {
    local pid_file="$PID_DIR/$1.pid"
    [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

start_service() {
    local name="$1"
    if is_running "$name"; then
        echo "  [$name] already running (PID $(cat "$PID_DIR/$name.pid"))"
        return 0
    fi

    # Check dependencies
    local dep
    dep="$(svc_dep "$name")"
    if [ -n "$dep" ] && ! is_running "$dep"; then
        echo "  [$name] starting dependency: $dep"
        start_service "$dep"
        sleep 1
    fi

    local cmd
    cmd="$(svc_cmd "$name")"

    echo "  [$name] starting: $(svc_desc "$name")"
    eval "$cmd" > "$LOG_DIR/$name.log" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_DIR/$name.pid"
    sleep 0.5

    if is_running "$name"; then
        echo "  [$name] started (PID $pid)"
    else
        echo "  [$name] FAILED to start — check $LOG_DIR/$name.log"
    fi
}

stop_service() {
    local name="$1"
    if ! is_running "$name"; then
        echo "  [$name] not running"
        return 0
    fi
    local pid
    pid="$(cat "$PID_DIR/$name.pid")"
    echo "  [$name] stopping (PID $pid)"
    kill "$pid" 2>/dev/null || true
    local i
    for i in 1 2 3; do
        if ! kill -0 "$pid" 2>/dev/null; then break; fi
        sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
        echo "  [$name] force-killed"
    fi
    rm -f "$PID_DIR/$name.pid"
    echo "  [$name] stopped"
}

show_status() {
    echo "CoreSapian.com — Service Status"
    echo "================================"
    for svc in $ALL_SERVICES; do
        if is_running "$svc"; then
            local pid
            pid="$(cat "$PID_DIR/$svc.pid")"
            echo "  OK $svc (PID $pid) — $(svc_desc "$svc")"
        else
            echo "  -- $svc — STOPPED"
        fi
    done
    echo ""
    echo "Logs: $LOG_DIR/"
}

tail_log() {
    local name="$1"
    local logfile="$LOG_DIR/$name.log"
    if [ ! -f "$logfile" ]; then
        echo "No log file for $name"
        return 1
    fi
    echo "=== Tailing $name (Ctrl+C to stop) ==="
    tail -f "$logfile"
}

# ── Main ───────────────────────────────────────────────────────────────
action="${1:-status}"
target="${2:-all}"

case "$action" in
    start)
        echo "Starting services..."
        if [ "$target" = "all" ]; then
            for svc in $ALL_SERVICES; do
                start_service "$svc"
            done
        else
            start_service "$target"
        fi
        echo ""
        show_status
        ;;
    stop)
        echo "Stopping services..."
        if [ "$target" = "all" ]; then
            # Reverse order
            set -- $ALL_SERVICES
            for svc in "$@"; do :; done
            while [ $# -gt 0 ]; do
                stop_service "$1"
                shift
            done
            # Simpler: just iterate reversed
            for svc in godot-server corechat enet-relay world-chat; do
                stop_service "$svc"
            done
        else
            stop_service "$target"
        fi
        echo ""
        show_status
        ;;
    restart)
        "$0" stop "$target"
        echo ""
        "$0" start "$target"
        ;;
    status)
        show_status
        ;;
    logs)
        tail_log "$target"
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs} [service|all]"
        echo ""
        echo "Services:"
        for svc in $ALL_SERVICES; do
            echo "  $svc — $(svc_desc "$svc")"
        done
        exit 1
        ;;
esac
