// ============================================================================
// api/game/state.ts — in-memory presence registry.
// Single source for "who is online" shared by the WS gateway (writer), the
// /api/status endpoint and the tRPC gameRouter (readers). Realm census is
// derived live from session realms — no persistence, presence is ephemeral.
// ============================================================================

import type { RealmId, Vec3 } from "@contracts/types";
import { REALM_IDS } from "@contracts/types";

export interface PresenceEntry {
  playerId: string;
  name: string;
  realm: RealmId;
  position: Vec3;
  connectedAt: number;
}

const presence = new Map<string, PresenceEntry>();

export function addPresence(entry: PresenceEntry): void {
  presence.set(entry.playerId, entry);
}

export function updatePresence(playerId: string, patch: { realm?: RealmId; position?: Vec3 }): void {
  const entry = presence.get(playerId);
  if (!entry) return;
  if (patch.realm) entry.realm = patch.realm;
  if (patch.position) entry.position = patch.position;
}

export function removePresence(playerId: string): void {
  presence.delete(playerId);
}

export function getPresence(playerId: string): PresenceEntry | undefined {
  return presence.get(playerId);
}

export function onlineCount(): number {
  return presence.size;
}

/** Players per realm — all nine realms always present (0 when empty). */
export function realmCensus(): Record<RealmId, number> {
  const census = Object.fromEntries(REALM_IDS.map((r) => [r, 0])) as Record<RealmId, number>;
  for (const entry of presence.values()) census[entry.realm] += 1;
  return census;
}
