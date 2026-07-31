// ============================================================================
// CORESAPIAN — ui realm tracking + decorative realm glyphs.
//
// The engine/world own the actual realm (RealmService); the store has no
// "current realm" field, so ui mirrors it from the event bus: HOME_REALM at
// boot, updated on `realm_change` / `player_respawn` (gdd §3.4).
// ============================================================================

import { useSyncExternalStore } from 'react';

import { gameEvents } from '@/game/events';
import type { RealmId } from '../../../contracts/types';
import { HOME_REALM, REALMS } from '../../../contracts/realms';
import { QUESTS } from '../../../contracts/quests';
import type { GameStore } from '../../../contracts/store-api';

// ---------------------------------------------------------------------------
// Current realm mirror
// ---------------------------------------------------------------------------

let currentRealm: RealmId = HOME_REALM;
const listeners = new Set<() => void>();

function setRealm(next: RealmId): void {
  if (next === currentRealm) return;
  currentRealm = next;
  for (const fn of listeners) fn();
}

gameEvents.on('realm_change', ({ to }) => setRealm(to));
gameEvents.on('player_respawn', ({ realm }) => setRealm(realm));

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useCurrentRealm(): RealmId {
  return useSyncExternalStore(subscribe, () => currentRealm);
}

export function getCurrentRealm(): RealmId {
  return currentRealm;
}

// ---------------------------------------------------------------------------
// Realm unlock derivation (addendum §7: quest chapter rewards; midgard always)
// ---------------------------------------------------------------------------

export function isRealmUnlocked(id: RealmId, quests: GameStore['quests']): boolean {
  if (id === 'midgard') return true;
  for (const q of Object.values(QUESTS)) {
    if (q.rewards.unlockRealm === id && quests[q.id]?.status === 'completed') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Decorative per-realm presentation (UI-only; gameplay data stays in
// contracts/realms.ts). Runes follow the game.md HUD vocabulary.
// ---------------------------------------------------------------------------

export const REALM_RUNES: Record<RealmId, string> = {
  midgard: 'ᛗ',
  alfheim: 'ᛚ',
  svartalfheim: 'ᛋ',
  jotunheim: 'ᛃ',
  niflheim: 'ᚾ',
  muspelheim: 'ᛖ',
  vanaheim: 'ᚹ',
  helheim: 'ᚺ',
  asgard: 'ᚨ',
};

/** Short epithets drawn from each realm's contracts description. */
export const REALM_EPITHETS: Record<RealmId, string> = {
  midgard: 'The middle enclosure, realm of humankind',
  alfheim: 'Luminous beyond mortal measure — and dimming',
  svartalfheim: 'The deep halls of the dvergar',
  jotunheim: 'The stone-cold east, stronghold of the jǫtnar',
  niflheim: 'The primordial mist-world, older than gods',
  muspelheim: 'The burning south, domain of fire-sons',
  vanaheim: 'The verdant west, old home of the Vanir',
  helheim: 'The grey halls beyond Gjallarbrú',
  asgard: 'The high enclosure of the Æsir',
};

export function realmAccent(id: RealmId): string {
  return REALMS[id].palette.accent;
}
