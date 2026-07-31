// ============================================================================
// CORESAPIAN — src/game/world/index.ts
// World subsystem entry (pinned factory name + id per addendum §1).
// Builds all nine realms from contracts/realms.ts: terrain, sky/fog/lighting,
// props, portals, resource nodes, weather particles, and seeded world events.
// ============================================================================

import type { GameContext, GameSubsystem } from '../Game';

import { RealmManager } from './realms';
import type { WorldContext } from './types';

export function createWorldSubsystem(): GameSubsystem {
  let manager: RealmManager | null = null;
  let elapsed = 0;

  return {
    id: 'world',

    init(ctx: GameContext) {
      manager = new RealmManager(ctx as WorldContext);
      manager.buildInitial();
    },

    fixedUpdate(dt: number) {
      manager?.fixedUpdate(dt);
    },

    update(dt: number) {
      elapsed += dt;
      manager?.update(dt, elapsed);
    },

    dispose() {
      manager?.dispose();
      manager = null;
    },
  };
}
