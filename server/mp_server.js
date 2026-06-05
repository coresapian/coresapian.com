#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 * CORESAPIAN — Multiplayer Orbs Relay Server v2.0
 *
 * Lightweight WebSocket relay: each client sends position updates,
 * server broadcasts them to every other connected client.
 *
 * Protocol (JSON over WebSocket):
 *   Client → Server:  { "type": "pos", "x", "y", "z", "ry", "rx" }
 *   Server → Client:  { "type": "init", "id": "p1a2b" }        (on connect)
 *   Server → Client:  { "type": "join", "id": "p1a2b" }        (another player joined)
 *   Server → Client:  { "type": "leave", "id": "p1a2b" }       (player disconnected)
 *   Server → Client:  { "type": "pos", "id": "p1a2b", ... }    (position relay)
 *
 * Features:
 *   • Per-client rate limiting (max 30 msg/s)
 *   • Heartbeat ping/pong (30s) — cleans dead connections
 *   • Graceful shutdown on SIGTERM/SIGINT
 *   • HTTP health endpoint at /
 *
 * Usage:  node mp_server.js
 * Env:    PORT=8082
 * ═══════════════════════════════════════════════════════════════════
 */

"use strict";

const { WebSocketServer, WebSocket } = require("ws");
const http = require("http");

// ── Config ──────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "8082", 10);
const MAX_MSG_PER_SEC = 30;
const HEARTBEAT_INTERVAL_MS = 30_000;

// ── Helpers ─────────────────────────────────────────────────────────
function makeId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "p";
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function timestamp() { return new Date().toISOString(); }
function now() { return Date.now() / 1000; }

// ── State ───────────────────────────────────────────────────────────
const clients = new Map(); // ws → { id, msgCount, lastCountReset, isAlive }

function playerCount() {
  return clients.size;
}

function broadcast(json, exclude = null) {
  const msg = JSON.stringify(json);
  for (const [ws] of clients) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// ── HTTP Health Server ──────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, players: playerCount() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// ── WebSocket Server ────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  const id = makeId();
  const client = {
    id,
    msgCount: 0,
    lastCountReset: now(),
    isAlive: true,
  };
  clients.set(ws, client);

  console.log(`[${timestamp()}] + connected ${id} (${playerCount()} players)`);

  // Send init + broadcast join to others
  ws.send(JSON.stringify({ type: "init", id }));
  broadcast({ type: "join", id }, ws);

  ws.on("message", (raw) => {
    // Rate limiting — max N messages per second
    const t = now();
    if (t - client.lastCountReset >= 1.0) {
      client.msgCount = 0;
      client.lastCountReset = t;
    }
    client.msgCount++;
    if (client.msgCount > MAX_MSG_PER_SEC) return;

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "pos") {
      broadcast({
        type: "pos",
        id,
        x: msg.x || 0,
        y: msg.y || 0,
        z: msg.z || 0,
        ry: msg.ry || 0,
        rx: msg.rx || 0,
      }, ws);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[${timestamp()}] - disconnected ${id} (${playerCount()} players)`);
    broadcast({ type: "leave", id });
  });

  ws.on("error", () => {});

  ws.on("pong", () => {
    client.isAlive = true;
  });
});

// ── Heartbeat ───────────────────────────────────────────────────────
const heartbeatInterval = setInterval(() => {
  for (const [ws, client] of clients) {
    if (!client.isAlive) {
      console.log(`[${timestamp()}] x timeout ${client.id}`);
      ws.terminate();
      clients.delete(ws);
      continue;
    }
    client.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_INTERVAL_MS);

// ── Graceful Shutdown ───────────────────────────────────────────────
function shutdown(signal) {
  console.log(`[coresapian-mp] ${signal} — shutting down`);
  clearInterval(heartbeatInterval);

  // Notify all clients
  for (const [ws, client] of clients) {
    try { ws.send(JSON.stringify({ type: "shutdown" })); } catch {}
    try { ws.close(1001, "Server shutting down"); } catch {}
  }

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("[coresapian-mp] Uncaught exception:", err.message);
});

// ── Start ───────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[coresapian-mp] Listening on ws://0.0.0.0:${PORT}`);
  console.log(`[coresapian-mp] Health check: http://localhost:${PORT}/`);
});
