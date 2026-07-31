// ============================================================================
// CORESAPIAN — src/game/rpg/index.ts
// Pinned entry (orchestrator addendum v1): factory createRpgSubsystem(),
// id "rpg". Composes the rpg-quests internals:
//
//   rpg/progression.ts   xp_gain → addXp, level_up follow-ups
//   rpg/inventory.ts     client-local op settlement (loot/harvest/rewards)
//   rpg/ops.ts           cross-agent op shapes/builders + ui helpers
//   rpg/crafting.ts      canCraft validation          (via ops.ts re-export)
//   rpg/shops.ts         faction-rank shop pricing    (via ops.ts re-export)
//   quests/runtime.ts    quest state machine, objectives, rewards, triggers
//   quests/dialogue.ts   dialogue tree walker + store Dialogue slice
//   npc/roster.ts        12-NPC roster, schedules, meshes, interactables
//
// fixedUpdate stage (gdd §3.3 #5): NPC schedules, quest triggers, loot pickup
// support. Loot interactables themselves are registered by combat-ai; their
// onInteract calls the op builders in rpg/ops.ts.
// ============================================================================

import type { GameContext, GameSubsystem } from '../Game';
import type { ServiceRegistry } from '../services';
import { createProgressionRuntime } from './progression';
import type { ProgressionRuntime } from './progression';
import { createInventoryRuntime } from './inventory';
import type { InventoryRuntime } from './inventory';
import { createQuestRuntime } from '../quests/runtime';
import type { QuestRuntimeApi } from '../quests/runtime';
import { createDialogueRuntime } from '../quests/dialogue';
import type { DialogueRuntimeApi } from '../quests/dialogue';
import { createNpcRoster } from '../npc/roster';
import type { NpcRosterApi } from '../npc/roster';
import { sweepOrphanPayloads } from './ops';

export function createRpgSubsystem(): GameSubsystem {
  let progression: ProgressionRuntime | null = null;
  let inventory: InventoryRuntime | null = null;
  let quests: QuestRuntimeApi | null = null;
  let dialogue: DialogueRuntimeApi | null = null;
  let roster: NpcRosterApi | null = null;
  let sweepTimer = 0;

  return {
    id: 'rpg',

    init(ctx: GameContext): void {
      // addendum §2: GameContext.services is provided by the engine; resolve
      // defensively and NEVER cache individual services (terrain re-registers
      // on realm change).
      const getServices = (): ServiceRegistry | undefined =>
        (ctx as GameContext & { services?: ServiceRegistry }).services;

      progression = createProgressionRuntime(ctx.store, ctx.events);
      inventory = createInventoryRuntime(ctx.store, ctx.events);
      quests = createQuestRuntime({
        store: ctx.store,
        events: ctx.events,
        scene: ctx.scene,
        getServices,
      });
      dialogue = createDialogueRuntime({
        store: ctx.store,
        events: ctx.events,
        getServices,
        quests,
      });
      roster = createNpcRoster({
        store: ctx.store,
        events: ctx.events,
        scene: ctx.scene,
        getServices,
        dialogue,
      });
      // Late-bind cross references (construction order: quests → dialogue →
      // roster).
      quests.setRoster(roster);
      const questRt = quests;
      roster.setShrineProvider(() => questRt.getShrinePositions());
    },

    fixedUpdate(dt: number): void {
      roster?.fixedUpdate(dt);
      quests?.fixedUpdate(dt);

      // Op-outbox leak guard (see rpg/ops.ts).
      sweepTimer += dt;
      if (sweepTimer >= 2) {
        sweepTimer = 0;
        sweepOrphanPayloads();
      }
    },

    dispose(): void {
      roster?.dispose();
      dialogue?.dispose();
      quests?.dispose();
      inventory?.dispose();
      progression?.dispose();
      roster = null;
      dialogue = null;
      quests = null;
      inventory = null;
      progression = null;
    },
  };
}
