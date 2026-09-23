// ═══════════════════════════════════════════════════════════════════
// CoreSapian — Unified relay server configuration
//
// Single source of truth for the merged multiplayer + chat relay
// (mp_server.js). Every value is overridable via environment variable;
// the fallbacks below are the coresapian.com defaults.
//
// Env var names match the datadelaurier canonical config so the union
// server code stays identical across repos (per-repo copies).
// ═══════════════════════════════════════════════════════════════════

import { env } from 'node:process';

/** Read an integer from an environment variable. */
function int(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Read a string from an environment variable. */
function str(name, fallback) {
  const raw = env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/** Read a comma-separated list from an environment variable. */
function list(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// ── Relay (multiplayer) config ────────────────────────────────────
export const mp = Object.freeze({
  port: int('PORT', 8082),
  bindHost: str('MP_BIND_HOST', '127.0.0.1'),
  heartbeatIntervalMs: int('MP_HEARTBEAT_INTERVAL_MS', 15_000),
  rateLimitMsgsPerSec: int('MP_RATE_LIMIT_MSGS_PER_SEC', 30),
  maxClients: int('MP_MAX_CLIENTS', 500),
  maxPosValue: int('MP_MAX_POS_VALUE', 100_000),
  maxChatLength: int('MP_MAX_CHAT_LENGTH', 500),
  allowedOrigins: list('MP_ALLOWED_ORIGINS', [
    'coresapian.com',
    'game.coresapian.com',
    'localhost',
  ]),
});

// ── Chat config (merged into the relay) ───────────────────────────
export const chat = Object.freeze({
  dataDir: str('CHAT_DATA_DIR', '/data'),
  maxHistory: int('CHAT_MAX_HISTORY', 200),
  maxNameLength: int('CHAT_MAX_NAME_LENGTH', 24),
  chatCooldownMs: int('CHAT_COOLDOWN_MS', 1_000),
  typingThrottleMs: int('CHAT_TYPING_THROTTLE_MS', 1500),
  leaveAnnounceMs: int('CHAT_LEAVE_ANNOUNCE_MS', 30_000),
  saveDebounceMs: int('CHAT_SAVE_DEBOUNCE_MS', 2_000),
});

// ── Shared helpers ────────────────────────────────────────────────
export function validateOrigin(origin, allowed) {
  if (!origin) return false;
  if (allowed.length === 0) return true;
  return allowed.some((o) =>
    origin === o ||
    origin.endsWith('://' + o) ||
    origin.includes('://' + o + ':') ||
    origin.includes('://' + o + '/')
  );
}

export default Object.freeze({ mp, chat });
