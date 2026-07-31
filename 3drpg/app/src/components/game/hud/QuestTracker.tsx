// ============================================================================
// CORESAPIAN — Quest tracker (game.md S3 top-right): active quest title,
// chapter chip, live objectives (□ open / ■ done) with progress, distance to
// a positioned objective when the engine probe has a player position.
// ============================================================================

import { useMemo, useState } from 'react';
import { ChevronRight, Scroll } from 'lucide-react';

import { QUESTS } from '../../../../contracts/quests';
import { REALMS } from '../../../../contracts/realms';
import { useGameStore } from '@/game/store';
import type { EngineProbe } from './probe';

export default function QuestTracker({ probe }: { probe: EngineProbe }) {
  const activeQuestId = useGameStore((s) => s.activeQuestId);
  const quests = useGameStore((s) => s.quests);
  const [collapsed, setCollapsed] = useState(false);

  const quest = activeQuestId ? QUESTS[activeQuestId] : undefined;
  const state = activeQuestId ? quests[activeQuestId] : undefined;

  const shown = useMemo(() => {
    if (!quest || !state || state.status === 'completed') return null;
    const objectives = quest.objectives.map((obj) => {
      const st = state.objectives.find((o) => o.objectiveId === obj.id);
      const dist =
        obj.position && probe.pos
          ? Math.round(Math.hypot(obj.position.x - probe.pos.x, obj.position.z - probe.pos.z))
          : null;
      return { obj, done: st?.done ?? false, current: st?.current ?? 0, dist };
    });
    const open = objectives.filter((o) => !o.done);
    return {
      quest,
      turnIn: state.status === 'ready_to_turn_in',
      objectives: [...open.slice(0, 2), ...objectives.filter((o) => o.done)].slice(0, 3),
      remaining: open.length,
    };
  }, [quest, state, probe.pos]);

  if (!shown) return null;

  const realm = REALMS[shown.quest.realm];

  return (
    <div className="pointer-events-none w-[260px]">
      <div className="panel border-l-2 border-l-phosphor/60 px-3 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="pointer-events-auto flex w-full items-center gap-2 text-left"
        >
          <Scroll size={12} className="flex-none text-phosphor" />
          <span className="micro flex-1 truncate text-bone">{shown.quest.name}</span>
          <ChevronRight
            size={12}
            className={`flex-none text-ash transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
          />
        </button>
        {!collapsed && (
          <div className="mt-2 border-t border-iron/60 pt-2">
            <div className="micro mb-1 text-ash">
              {shown.quest.type === 'main' ? `CHAPTER ${shown.quest.chapter}` : 'SIDE SAGA'} ·{' '}
              {realm.displayName.toUpperCase()}
              {shown.turnIn && <span className="ml-1 text-soul">— RETURN TO THE GIVER</span>}
            </div>
            {shown.objectives.map(({ obj, done, current, dist }) => (
              <div key={obj.id} className="flex items-baseline gap-2 py-0.5">
                <span className={done ? 'text-soul' : 'text-phosphor'}>{done ? '■' : '□'}</span>
                <span
                  className={`micro flex-1 leading-snug ${done ? 'text-ash line-through' : 'text-bone-dim'}`}
                >
                  {obj.text}
                  {obj.qty > 1 && !done && (
                    <span className="stat ml-1 text-phosphor">
                      {current}/{obj.qty}
                    </span>
                  )}
                </span>
                {dist !== null && !done && <span className="stat micro text-ash">{dist}m</span>}
              </div>
            ))}
            {shown.remaining > 2 && (
              <div className="micro mt-1 text-ash">+{shown.remaining - 2} MORE…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
