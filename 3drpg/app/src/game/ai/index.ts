// ============================================================================
// CORESAPIAN — src/game/ai/index.ts (combat-ai)
//
// Pinned subsystem entry (orchestrator addendum v1): enemy FSM, spawning,
// bosses, loot. Registers the `enemies` EnemyService into the registry.
// ============================================================================

import type { GameContext, GameSubsystem } from '../Game';
import type { ServiceRegistry } from '../services';
import { EnemyManager, setEnemyManager } from './enemyManager';

/** GameContext.services per addendum §2 (optional on the context type). */
function servicesOf(ctx: GameContext): ServiceRegistry | null {
  return (ctx as GameContext & { services?: ServiceRegistry }).services ?? null;
}

export function createAISubsystem(): GameSubsystem {
  let manager: EnemyManager | null = null;
  let ctxRef: GameContext | null = null;
  let unsubRealm: (() => void) | null = null;
  let unsubStore: (() => void) | null = null;
  let wasDead = false;

  return {
    id: 'ai',

    init(ctx: GameContext): void {
      ctxRef = ctx;
      const services = servicesOf(ctx);
      const m = new EnemyManager({
        scene: ctx.scene,
        store: ctx.store,
        events: ctx.events,
        services: {
          player: () => services?.get('player') ?? null,
          terrain: () => services?.get('terrain') ?? null,
          interactables: () => services?.get('interactables') ?? null,
        },
      });
      manager = m;
      setEnemyManager(m);

      // combat-ai provides the `enemies` service (addendum §2).
      services?.register('enemies', {
        damageEnemy: (enemyId, amount, opts) => m.damageEnemy(enemyId, amount, opts),
        spawnEnemy: (enemyType, pos, opts) => m.spawnEnemy(enemyType, pos, opts),
        despawnEnemy: (enemyId) => m.despawnEnemy(enemyId),
      });

      unsubRealm = ctx.events.on('realm_change', () => m.resetForRealm());

      // gdd §11.2: on death, nearby enemies deaggro and arenas reset.
      wasDead = ctx.store.getState().dead;
      unsubStore = ctx.store.subscribe((s) => {
        if (s.dead && !wasDead) m.onPlayerDied();
        wasDead = s.dead;
      });
    },

    fixedUpdate(dt: number): void {
      manager?.fixedUpdate(dt);
    },

    update(dt: number): void {
      if (ctxRef) manager?.update(dt, ctxRef.camera);
    },

    dispose(): void {
      unsubRealm?.();
      unsubStore?.();
      setEnemyManager(null);
      manager?.dispose();
      manager = null;
      ctxRef = null;
    },
  };
}
