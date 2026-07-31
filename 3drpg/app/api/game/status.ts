// ============================================================================
// api/game/status.ts — GET /api/status for site widgets (multiplayer page
// polls this). Mounted in boot.ts BEFORE the /api/* 404 catcher.
//
// Query params:
//   ?ts=<client_ms> — echoed back so the client can compute its own HTTP
//   round-trip latency without server-side state.
// ============================================================================

import type { Context } from "hono";
import { onlineCount } from "./state";
import { env } from "../lib/env";

export function statusHandler(c: Context) {
  const shard = env.appId || "BIFRÖST-EU";
  const clientTs = Number(c.req.query("ts") ?? NaN);
  const serverTs = Date.now();
  const response: Record<string, unknown> = {
    ok: true,
    playersOnline: onlineCount(),
    uptime: Math.floor(process.uptime()),
    shard,
    serverTime: serverTs,
  };
  if (Number.isFinite(clientTs)) {
    response.clientTs = clientTs;
    response.serverTs = serverTs;
  }
  return c.json(response);
}
