// ============================================================================
// CORESAPIAN — src/game/rpg/progression.ts
// Progression application (addendum §6): rpg-quests owns Progression writes.
// Listens to `xp_gain` (sources: enemy type ids, "boss:<id>", "event:<id>",
// "quest:<id>"), applies addXp (the store runs the level-up curve from
// contracts/skills.ts), and emits `level_up` follow-ups + HUD toasts + sfx.
//
// Skill-effect QUERIES (damage mults, xp mults, etc.) are other agents' job —
// they read store.skills + contracts/skills.ts themselves. Skill point spends
// from ui go through requestSpendSkillPoint in rpg/ops.ts; realm ability
// unlocks arrive via quest rewards (quests/runtime.ts).
// ============================================================================

import type { GameEventBus } from '../events';
import type { UseGameStore } from '../store';

export interface ProgressionRuntime {
  dispose(): void;
}

export function createProgressionRuntime(
  store: UseGameStore,
  events: GameEventBus,
): ProgressionRuntime {
  const unsubXp = events.on('xp_gain', ({ amount }) => {
    if (amount <= 0) return;
    const before = store.getState();
    const levelBefore = before.level;
    before.addXp(amount);
    const after = store.getState();

    if (after.level > levelBefore) {
      events.emit('level_up', { level: after.level, skillPoints: after.skillPoints });
      events.emit('play_sfx', { sfxId: 'sfx.levelup' });
      after.notify('level', `Level ${after.level} reached — skill point earned.`);
    }
  });

  return {
    dispose() {
      unsubXp();
    },
  };
}
