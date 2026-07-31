// ============================================================================
// CORESAPIAN — ui-local auxiliary state (not part of the frozen GameStore).
// Session-only: shop panel session, death killer credit, event-driven HUD
// flashes that have no store slice.
// ============================================================================

import { create } from 'zustand';

import { gameEvents } from '@/game/events';
import { ENEMIES, REALM_BOSSES } from '../../../contracts/enemies';

// ---------------------------------------------------------------------------
// Killer credit — combat-ai emits player_died { sourceId }; sourceId is an
// enemy instance/type id. Resolve to a display name best-effort.
// ---------------------------------------------------------------------------

export function resolveKillerName(sourceId: string): string {
  if (!sourceId) return 'the Nine Realms';
  if (ENEMIES[sourceId]) return ENEMIES[sourceId].name;
  if (REALM_BOSSES[sourceId]) return REALM_BOSSES[sourceId].name;
  // Instance ids may embed the type id — longest contract-id prefix wins.
  let best: string | null = null;
  let bestLen = 0;
  for (const [id, def] of [
    ...Object.entries(ENEMIES),
    ...Object.entries(REALM_BOSSES),
  ]) {
    if (sourceId.startsWith(id) && id.length > bestLen) {
      best = def.name;
      bestLen = id.length;
    }
  }
  return best ?? 'the Nine Realms';
}

// ---------------------------------------------------------------------------
// uiAux store
// ---------------------------------------------------------------------------

interface UiAuxState {
  /** Open shop (opened via dialogue `open_shop` effects). */
  shopId: string | null;
  shopNpcId: string | null;
  openShop: (npcId: string, shopId: string) => void;
  closeShop: () => void;

  /** Last killer credit for the death screen. */
  lastKiller: string | null;
  /** Epoch ms when the current death started (drives the recap line). */
  diedAt: number;

  /** World-event banner flash (from world_event bus events). */
  eventFlash: { text: string; kind: string; at: number } | null;

  /** Set by BootScreen once the loading overlay starts fading (spawn moment). */
  bootDone: boolean;
  setBootDone: (v: boolean) => void;
}

export const useUiAux = create<UiAuxState>()((set) => ({
  shopId: null,
  shopNpcId: null,
  openShop: (npcId, shopId) => set({ shopId: shopId, shopNpcId: npcId }),
  closeShop: () => set({ shopId: null, shopNpcId: null }),

  lastKiller: null,
  diedAt: 0,

  eventFlash: null,

  bootDone: false,
  setBootDone: (v) => set({ bootDone: v }),
}));

// Death credit tracking (combat-ai → ui, gdd §3.4).
gameEvents.on('player_died', ({ sourceId }) => {
  useUiAux.setState({ lastKiller: resolveKillerName(sourceId), diedAt: Date.now() });
});

// World-event announcements flash (world → ui).
gameEvents.on('world_event', ({ event, phase }) => {
  if (phase === 'ended') return;
  const verb = phase === 'announced' ? 'GATHERS' : 'IS UPON THE REALM';
  useUiAux.setState({
    eventFlash: { text: `${event.name} ${verb}`, kind: event.kind, at: Date.now() },
  });
});
