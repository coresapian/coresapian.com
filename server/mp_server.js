// ═══════════════════════════════════════════════════════════════════
// Multiplayer + Chat Relay Server v3.0 (unified)
//
// CANONICAL COPY — this file is identical in the coresapian,
// datadelaurier, and daviddelaurier repos (per-repo copies, not a
// shared module). Per-site behavior differences live in config.js.
//
// Feature union of the three per-site orb relay servers with the
// standalone anonymous chat server merged in. A single port serves both
// the multiplayer position relay and the chat panel.
//
// Protocol (JSON over WebSocket):
//   Client → Server:
//     { "type": "pos", "x", "y", "z", "ry", "rx" }   position update
//     { "type": "chat", "text", "name"? }              chat (mp style)
//     { "text", "name"? }                             chat (panel style, no type)
//     { "type": "typing", "name"? }                   typing indicator (ephemeral)
//     { "type": "hello", "name"? }                    join announcement (once)
//     { "type": "ping", "t" }                         RTT probe
//   Server → Client:
//     { "type": "init", "id" }                         assigned player id (first)
//     { "type": "history", "messages": [...] }         last chat messages (if any)
//     { "type": "join", "id" }                         another player joined
//     { "type": "leave", "id" }                        player disconnected
//     { "type": "pos", "id", "x", "y", "z", "ry", "rx" }
//     { "type": "chat", "id", "name", "text", "timestamp" }
//     { "type": "typing", "id", "name" }              someone is typing
//     { "type": "system", "message" }                   join/leave/rate-limit notices
//     { "type": "pong", "t" }                           ping echo (sender only)
//     { "type": "shutdown" }                             server is restarting
//
// Notes:
//   • Chat is broadcast to ALL clients INCLUDING the sender (the chat
//     panel renders only server-echoed messages). Game clients should
//     ignore chat/typing messages carrying their own id.
//   • Names are optional; unnamed senders appear as "anonymous".
//   • Chat history persists to CHAT_DATA_DIR/chatlog.json across restarts.
//
// Union of features:
//   • 15s heartbeat sweep, 30 msg/s per-client rate limit (datadelaurier)
//   • 1 msg/s chat cooldown anti-spam (daviddelaurier)
//   • maxPayload 4096, perMessageDeflate off, 500 clients (datadelaurier)
//   • Unique player ids, clamped positions, origin allowlist (all three)
//   • Named handles, history persistence, hello/leave announcements,
//     typing throttle, control-char sanitizing (standalone chat server)
//   • HTTP health endpoint at / and /health (all three)
//   • Graceful shutdown with client notice (coresapian, datadelaurier)
//
// Usage:  npm install && npm start        (PORT and friends via config.js)
// NOTE: package.json must have "type": "module" — this file uses ESM imports.

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';

import { mp as config, chat as chatConfig, validateOrigin } from './config.js';

const PORT = config.port;
const BIND_HOST = config.bindHost;
const HEARTBEAT_INTERVAL_MS = config.heartbeatIntervalMs;
const RATE_LIMIT_MSGS_PER_SEC = config.rateLimitMsgsPerSec;
const MAX_CLIENTS = config.maxClients;
const MAX_POS_VALUE = config.maxPosValue;

const DATA_DIR = chatConfig.dataDir;
const LOG_FILE = path.join(DATA_DIR, 'chatlog.json');
const MAX_HISTORY = chatConfig.maxHistory;
const MAX_CHAT_LENGTH = config.maxChatLength;
const MAX_NAME_LENGTH = chatConfig.maxNameLength;
const CHAT_COOLDOWN_MS = chatConfig.chatCooldownMs;
const TYPING_THROTTLE_MS = chatConfig.typingThrottleMs;
const LEAVE_ANNOUNCE_MS = chatConfig.leaveAnnounceMs;
const SAVE_DEBOUNCE_MS = chatConfig.saveDebounceMs;

// ── Player ID generator ────────────────────────────────────────────

function makeId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'p';
    for (let i = 0; i < 4; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

// IDs must be unique among connected players — a collision would make
// two players' position/chat packets fight over a single remote orb.
function isIdInUse(id) {
    for (const [, client] of clients) {
        if (client.id === id) return true;
    }
    return false;
}

function makeUniqueId() {
    let id;
    do {
        id = makeId();
    } while (isIdInUse(id));
    return id;
}

// Clamp position values to prevent Infinity/NaN/garbage from clients.
function clampPos(v) {
    const n = Number(v) || 0;
    if (!Number.isFinite(n)) return 0;
    return Math.max(-MAX_POS_VALUE, Math.min(MAX_POS_VALUE, n));
}

function now() { return Date.now() / 1000; }
function timestamp() { return new Date().toISOString(); }

// ── Chat persistence ───────────────────────────────────────────────

function ensureDataDir() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (err) {
        console.warn(`[relay] Could not create data dir ${DATA_DIR}:`, err.message);
    }
}

function loadHistory() {
    try {
        if (fs.existsSync(LOG_FILE)) {
            const raw = fs.readFileSync(LOG_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) return data.slice(-MAX_HISTORY);
        }
    } catch (err) {
        console.warn('[relay] Failed to load chat history:', err.message);
    }
    return [];
}

function saveHistorySync(history) {
    try {
        const trimmed = history.slice(-MAX_HISTORY);
        const tmpFile = `${LOG_FILE}.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify(trimmed), 'utf8');
        fs.renameSync(tmpFile, LOG_FILE); // atomic replace
    } catch (err) {
        console.warn('[relay] Failed to save chat history:', err.message);
    }
}

// Debounced save — coalesces rapid writes into a single file write.
// Reads the current `history` at fire time, not at schedule time.
let saveTimer = null;
function saveHistory() {
    if (saveTimer) return; // already pending
    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveHistorySync(history);
    }, SAVE_DEBOUNCE_MS);
}

// ── Chat sanitizing ────────────────────────────────────────────────

// Strip all control characters (except tab \x09, LF \x0A, CR \x0D).
// eslint-disable-next-line no-control-regex -- intentional: sanitizing user input
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function stripControlChars(input) {
    return String(input).replace(CONTROL_CHARS_RE, '');
}

function cleanChatText(input) {
    if (typeof input !== 'string') return '';
    return stripControlChars(input).trim().slice(0, MAX_CHAT_LENGTH);
}

function sanitizeName(input) {
    if (typeof input !== 'string') return 'anonymous';
    const name = stripControlChars(input).trim();
    if (!name) return 'anonymous';
    return name.slice(0, MAX_NAME_LENGTH);
}

// ── State ──────────────────────────────────────────────────────────

ensureDataDir();
let history = loadHistory();
console.log(`[relay] Chat history: ${LOG_FILE} (${history.length} messages loaded)`);

const clients = new Map(); // ws → client meta

function playerCount() { return clients.size; }

function sendTo(ws, json) {
    if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(json)); } catch {}
    }
}

function broadcast(json, exclude = null) {
    // Pre-encode to Buffer once — avoids per-client UTF-8 re-encoding.
    const msg = Buffer.from(JSON.stringify(json));
    for (const [ws] of clients) {
        if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
            try { ws.send(msg); } catch {}
        }
    }
}

// ── HTTP health-check + upgrade to WebSocket ───────────────────────

const server = createServer((req, res) => {
    if (req.url === '/' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, players: playerCount() }));
    } else {
        res.writeHead(404);
        res.end();
    }
});

// perMessageDeflate disabled — position payloads are tiny (~60 bytes),
// deflate overhead adds latency without meaningful size savings.
// maxPayload caps the per-message buffer: ws's 100 MiB default lets any
// client force ~100 MB of buffering per connection (500 clients ≈ 50 GB
// worst case → OOM kills the relay for every visitor). Chat messages are
// ≤500 chars; 4 KiB is generous.
const wss = new WebSocketServer({
    server,
    perMessageDeflate: false,
    maxPayload: 4096,
    verifyClient: (info, cb) => {
        const origin = info.origin || info.req.headers.origin || '';
        if (!origin) return cb(true); // allow connections without origin (game clients, curl)
        if (config.allowedOrigins.length === 0) return cb(true);
        if (validateOrigin(origin, config.allowedOrigins)) return cb(true);
        console.warn(`[relay] Rejected connection from origin: ${origin}`);
        cb(false, 401, 'Forbidden origin');
    },
});

// ── Chat message path (shared by mp-style and panel-style messages) ─

function handleChat(ws, client, text, name) {
    // Anti-spam: 1 chat message per second per client.
    const nowMs = Date.now();
    if (nowMs - client.lastChatTime < CHAT_COOLDOWN_MS) {
        sendTo(ws, { type: 'system', message: '[rate limited — slow down]' });
        return;
    }
    client.lastChatTime = nowMs;

    const senderName = sanitizeName(name ?? client.name);
    if (name && senderName !== 'anonymous') client.name = senderName;

    const message = {
        type: 'chat',
        id: client.id,
        name: senderName,
        text,
        timestamp: new Date().toISOString(),
    };

    history.push(message);
    if (history.length > MAX_HISTORY * 2) history = history.slice(-MAX_HISTORY);
    saveHistory();

    // Broadcast to everyone INCLUDING the sender — the chat panel renders
    // only server-echoed messages. Game clients should ignore chat/typing
    // messages carrying their own id.
    broadcast(message);
}

wss.on('connection', (ws) => {
    if (clients.size >= MAX_CLIENTS) {
        ws.close(1013, 'Maximum connections reached');
        return;
    }

    const id = makeUniqueId();
    const client = {
        id,
        name: null,
        msgCount: 0,
        lastCountReset: now(),
        lastChatTime: 0,
        lastTypingAt: 0,
        announced: false,
        joinedAt: 0,
        isAlive: true,
    };
    clients.set(ws, client);

    console.log(`[${timestamp()}] + connected ${id} (${playerCount()} players)`);

    // init first — clients may assume the first message is init.
    sendTo(ws, { type: 'init', id });
    if (history.length > 0) {
        sendTo(ws, { type: 'history', messages: history.slice(-MAX_HISTORY) });
    }
    broadcast({ type: 'join', id }, ws);

    // ── Handle incoming messages ────────────────────────────────────

    ws.on('message', (raw) => {
        // Rate limit: N msgs/sec per client (all message types).
        const t = now();
        if (t - client.lastCountReset >= 1.0) {
            client.msgCount = 0;
            client.lastCountReset = t;
        }
        client.msgCount++;
        if (client.msgCount > RATE_LIMIT_MSGS_PER_SEC) return; // drop

        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch {
            return; // invalid JSON
        }
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'pos') {
            broadcast({
                type: 'pos',
                id,
                x: clampPos(msg.x),
                y: clampPos(msg.y),
                z: clampPos(msg.z),
                ry: clampPos(msg.ry),
                rx: clampPos(msg.rx),
            }, ws);
        } else if (msg.type === 'chat' || (!msg.type && typeof msg.text === 'string')) {
            // mp-style {type:'chat',...} and panel-style {text,...} (no type).
            const text = cleanChatText(msg.text);
            if (text) handleChat(ws, client, text, msg.name);
        } else if (msg.type === 'typing') {
            // Ephemeral typing indicator — throttled, never persisted.
            const name = sanitizeName(msg.name ?? client.name);
            if (name === 'anonymous' && !client.name) return; // unnamed typing is noise
            const nowMs = Date.now();
            if (nowMs - client.lastTypingAt < TYPING_THROTTLE_MS) return;
            client.lastTypingAt = nowMs;
            broadcast({ type: 'typing', id, name }, ws);
        } else if (msg.type === 'hello') {
            // Join announcement — once per connection.
            if (client.announced) return;
            client.announced = true;
            const name = sanitizeName(msg.name);
            if (name === 'anonymous') return;
            client.name = name;
            client.joinedAt = Date.now();
            broadcast({ type: 'system', message: `${name} entered the channel` });
        } else if (msg.type === 'ping' && typeof msg.t === 'number') {
            // RTT probe — echo to the sender only (never broadcast).
            sendTo(ws, { type: 'pong', t: msg.t });
        }
        // Unknown message types are ignored.
    });

    // ── Handle disconnect ───────────────────────────────────────────

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`[${timestamp()}] - disconnected ${id} (${playerCount()} players)`);
        broadcast({ type: 'leave', id });
        // Announce named departures — but only for connections that
        // introduced themselves and stuck around. Flapping connections
        // (reconnect cycles) must not spam enter/leave pairs.
        if (client.announced && client.name && client.joinedAt
            && Date.now() - client.joinedAt >= LEAVE_ANNOUNCE_MS) {
            broadcast({ type: 'system', message: `${client.name} left the channel` });
        }
    });

    ws.on('error', () => {
        // close handler will fire after this
    });

    ws.on('pong', () => {
        client.isAlive = true;
    });
});

// ── Heartbeat sweep ────────────────────────────────────────────────

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
heartbeatInterval.unref?.();

// ── Graceful shutdown ──────────────────────────────────────────────

function shutdown(signal) {
    console.log(`[relay] ${signal} — shutting down`);
    clearInterval(heartbeatInterval);
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    saveHistorySync(history); // persist chat before exit
    for (const [ws] of clients) {
        try { ws.send(JSON.stringify({ type: 'shutdown' })); } catch {}
        try { ws.close(1001, 'Server shutting down'); } catch {}
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    console.error('[relay] Uncaught exception — exiting:', err.stack || err.message);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('[relay] Unhandled rejection — exiting:', reason);
    process.exit(1);
});

// ── Start ──────────────────────────────────────────────────────────

server.listen(PORT, BIND_HOST, () => {
    console.log(`[relay] Listening on ws://${BIND_HOST}:${PORT}`);
    console.log(`[relay] Health check: http://${BIND_HOST}:${PORT}/`);
});
