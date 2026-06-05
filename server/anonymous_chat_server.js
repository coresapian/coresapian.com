#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 * CORESAPIAN — Anonymous Chat WebSocket Server v2.0
 *
 * Lightweight Node.js WebSocket server for the Coresapian 3D lab
 * anonymous chat panel. No authentication, no usernames — all
 * messages are completely anonymous.
 *
 * Features:
 *   • Broadcasts every message to all connected clients
 *   • Persists messages to JSON file (survives restarts)
 *   • Sends last 200 messages to new connections
 *   • WebSocket heartbeat (30s ping/pong) — cleans dead connections
 *   • Per-client rate limiting (max 10 msg / 10s)
 *   • Debounced file saves (max once per 2s)
 *   • Graceful shutdown with forced save
 *   • Message format: { text, timestamp }
 *
 * Usage:  node anonymous_chat_server.js [--port 3001] [--data /data]
 * ═══════════════════════════════════════════════════════════════════
 */

"use strict";

const { WebSocketServer } = require("ws");
const fs = require("fs");
const path = require("path");

// ── Config ──────────────────────────────────────────────────────────
const PORT = parseInt(process.env.CHAT_PORT || "3001", 10);
const DATA_DIR = process.env.CHAT_DATA_DIR || "/data";
const LOG_FILE = path.join(DATA_DIR, "chatlog.json");
const MAX_HISTORY = 200;
const MAX_MESSAGE_LENGTH = 500;
const MAX_CLIENTS = 500;

// Heartbeat: ping every 30s, terminate if no pong for 60s
const HEARTBEAT_INTERVAL_MS = 30_000;

// Rate limiting: max 10 messages per 10-second sliding window per client
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 10_000;

// Debounced save: max once per 2s, always on shutdown
const SAVE_DEBOUNCE_MS = 2_000;

// ── Persistence ─────────────────────────────────────────────────────
function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.warn(`[chat] Could not create data dir ${DATA_DIR}:`, err.message);
  }
}

function loadHistory() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const raw = fs.readFileSync(LOG_FILE, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data.slice(-MAX_HISTORY);
    }
  } catch (err) {
    console.warn("[chat] Failed to load history:", err.message);
  }
  return [];
}

function saveHistorySync(history) {
  try {
    const trimmed = history.slice(-MAX_HISTORY);
    fs.writeFileSync(LOG_FILE, JSON.stringify(trimmed), "utf8");
  } catch (err) {
    console.warn("[chat] Failed to save history:", err.message);
  }
}

// Debounced save — coalesces rapid writes into a single file write
let saveTimer = null;
function saveHistory(history) {
  if (saveTimer) return; // Already pending
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveHistorySync(history);
  }, SAVE_DEBOUNCE_MS);
}

// ── Rate Limiting (per-client sliding window) ──────────────────────
function createRateLimiter() {
  const timestamps = [];
  return function hit() {
    const now = Date.now();
    // Purge entries outside the window
    while (timestamps.length > 0 && now - timestamps[0] > RATE_LIMIT_WINDOW_MS) {
      timestamps.shift();
    }
    if (timestamps.length >= RATE_LIMIT_MAX) return false;
    timestamps.push(now);
    return true;
  };
}

// ── State ───────────────────────────────────────────────────────────
ensureDataDir();
let history = loadHistory();
const clients = new Map(); // ws → { rateLimiter, isAlive }

// ── Broadcast helper ────────────────────────────────────────────────
function broadcast(payload) {
  for (const [client] of clients) {
    if (client.readyState === 1) { // WebSocket.OPEN === 1
      client.send(payload);
    }
  }
}

// ── WebSocket Server ────────────────────────────────────────────────
const wss = new WebSocketServer({
  port: PORT,
  host: "0.0.0.0",
  // Allow no origin restriction (anonymous, same-origin via nginx)
  verifyClient: () => true,
});

console.log(`[chat] Anonymous chat server listening on ws://0.0.0.0:${PORT}`);
console.log(`[chat] Persistence: ${LOG_FILE} (${history.length} messages loaded)`);

wss.on("connection", (ws, req) => {
  // Enforce max clients
  if (clients.size >= MAX_CLIENTS) {
    ws.close(1013, "Maximum connections reached");
    return;
  }

  const meta = { rateLimiter: createRateLimiter(), isAlive: true };
  clients.set(ws, meta);
  const ip = req.socket.remoteAddress || "unknown";
  console.log(`[chat] Client connected (${ip}) — total: ${clients.size}`);

  // Send full history to new client
  if (history.length > 0) {
    try {
      ws.send(JSON.stringify(history));
    } catch (err) {
      console.warn("[chat] Failed to send history:", err.message);
    }
  }

  // Handle incoming messages
  ws.on("message", (data, isBinary) => {
    try {
      const raw = isBinary ? data.toString("utf8") : String(data);
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed.text !== "string") return;

      const text = parsed.text.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!text) return;

      // Rate limit check
      if (!meta.rateLimiter()) {
        try {
          ws.send(JSON.stringify({ type: "system", message: "[rate limited]" }));
        } catch {}
        return;
      }

      const message = {
        text,
        timestamp: new Date().toISOString(),
      };

      // Persist (debounced)
      history.push(message);
      if (history.length > MAX_HISTORY * 2) {
        history = history.slice(-MAX_HISTORY);
      }
      saveHistory(history);

      // Broadcast to all clients (including sender)
      broadcast(JSON.stringify(message));
    } catch (err) {
      console.warn("[chat] Message handling error:", err.message);
    }
  });

  // Pong handler — mark connection as alive
  ws.on("pong", () => {
    meta.isAlive = true;
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[chat] Client disconnected — total: ${clients.size}`);
  });

  ws.on("error", (err) => {
    console.warn("[chat] Client error:", err.message);
    clients.delete(ws);
  });
});

// ── Heartbeat: ping all clients, terminate dead ones ────────────────
const heartbeatInterval = setInterval(() => {
  for (const [ws, meta] of clients) {
    if (!meta.isAlive) {
      ws.terminate();
      clients.delete(ws);
      continue;
    }
    meta.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_INTERVAL_MS);

// ── Graceful shutdown ───────────────────────────────────────────────
function shutdown(signal) {
  console.log(`[chat] ${signal} — shutting down`);
  clearInterval(heartbeatInterval);
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveHistorySync(history); // Force immediate save
  wss.close(() => process.exit(0));
  // Force exit after 3s if close hangs
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Catch uncaught errors — don't crash
process.on("uncaughtException", (err) => {
  console.error("[chat] Uncaught exception:", err.message);
});
