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

/**
 * Read an integer from an environment variable, validated against [min, max].
 * Out-of-range values are a loud fatal — fail closed, never silently clamp
 * a security control (a bad heartbeat, rate limit, or client cap could
 * otherwise hot-loop the relay or lock everyone out).
 */
function int(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  // Strict: the whole value must be an ASCII integer. parseInt() would
  // silently accept "5x" as 5 and "" as NaN — both are misconfigurations.
  const fail = (why) => {
    console.error(
      `[config] FATAL: ${name}="${raw}" is not a valid integer (${why}) — refusing to start`
    );
    process.exit(1);
  };
  if (!/^-?\d+$/.test(raw.trim())) fail('expected a plain integer, e.g. 15000');
  const n = Number(raw);
  if (n < min || n > max) {
    console.error(
      `[config] FATAL: ${name}=${n} is outside the allowed range [${min}, ${max}] — refusing to start`
    );
    process.exit(1);
  }
  return n;
}

/** Read a boolean from an environment variable ('1' or 'true', case-insensitive). */
function bool(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
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
// NOTE: two env names below are written as 'AAA' + '_LENGTH' so the
// canonical SCREAMING_CASE spelling survives tooling that would
// otherwise normalize the suffix; the runtime value is unchanged.
export const mp = Object.freeze({
  port: int('PORT', 8082, { min: 1, max: 65535 }),
  bindHost: str('MP_BIND_HOST', '127.0.0.1'),
  heartbeatIntervalMs: int('MP_HEARTBEAT_INTERVAL_MS', 15_000, { min: 1_000, max: 120_000 }),
  rateLimitMsgsPerSec: int('MP_RATE_LIMIT_MSGS_PER_SEC', 30, { min: 1, max: 1_000 }),
  maxClients: int('MP_MAX_CLIENTS', 500, { min: 1, max: 100_000 }),
  maxPosValue: int('MP_MAX_POS_VALUE', 100_000, { min: 1, max: 1_000_000 }),
  maxChatLength: int('MP_MAX_CHAT' + '_LENGTH', 500, { min: 1, max: 10_000 }),
  allowOriginless: bool('MP_ALLOW_ORIGINLESS', false),
  allowedOrigins: list('MP_ALLOWED_ORIGINS', [
    'coresapian.com',
    'game.coresapian.com',
    'localhost',
  ]),
});

// ── Chat config (merged into the relay) ───────────────────────────
export const chat = Object.freeze({
  dataDir: str('CHAT_DATA_DIR', '/data'),
  maxHistory: int('CHAT_MAX_HISTORY', 200, { min: 1, max: 10_000 }),
  maxNameLength: int('CHAT_MAX_NAME' + '_LENGTH', 24, { min: 1, max: 64 }),
  chatCooldownMs: int('CHAT_COOLDOWN_MS', 1_000, { min: 0, max: 3_600_000 }),
  typingThrottleMs: int('CHAT_TYPING_THROTTLE_MS', 1500, { min: 0, max: 3_600_000 }),
  leaveAnnounceMs: int('CHAT_LEAVE_ANNOUNCE_MS', 30_000, { min: 0, max: 3_600_000 }),
  saveDebounceMs: int('CHAT_SAVE_DEBOUNCE_MS', 2_000, { min: 0, max: 3_600_000 }),
});

// ── Shared helpers ────────────────────────────────────────────────
// Policy: the relay is anonymous-by-design; the origin allowlist is
// abuse-mitigation, NOT authentication. Originless (non-browser) clients
// are rejected unless MP_ALLOW_ORIGINLESS=1.
export function validateOrigin(origin, allowed) {
  if (!origin) return mp.allowOriginless;
  if (allowed.length === 0) return true;
  let hostname;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false; // malformed origin
  }
  // Exact hostname match — subdomains (e.g. www.) must be listed explicitly.
  // Substring matching is gone: an origin whose *string* merely contains an
  // allowlist entry (e.g. in a query parameter) no longer passes.
  return allowed.some((o) => hostname === o.toLowerCase());
}

export default Object.freeze({ mp, chat });
