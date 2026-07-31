// ============================================================================
// CORESAPIAN — Quest log, "The Sagas" (game.md S9): campaign chapters + side
// quests from contracts QUESTS + store quest state; objectives with live
// progress; recorded branch outcomes; rewards; TRACK → setActiveQuest.
// ============================================================================

import { useMemo, useState } from 'react';
import { Scroll } from 'lucide-react';

import { NPCS, QUESTS } from '../../../../contracts/quests';
import { REALM_ABILITIES } from '../../../../contracts/skills';
import { ITEMS } from '../../../../contracts/items';
import { REALMS } from '../../../../contracts/realms';
import { useGameStore } from '@/game/store';
import { MenuAction, MenuShell } from './menuShared';

const STATUS_GLYPH: Record<string, { glyph: string; className: string; label: string }> = {
  active: { glyph: '▶', className: 'text-phosphor', label: 'ACTIVE' },
  ready_to_turn_in: { glyph: '▣', className: 'text-soul', label: 'READY TO TURN IN' },
  completed: { glyph: '✓', className: 'text-ash', label: 'SUNG' },
  unknown: { glyph: '○', className: 'text-bone-dim', label: 'UNWRITTEN' },
};

export default function QuestsMenu() {
  const quests = useGameStore((s) => s.quests);
  const activeQuestId = useGameStore((s) => s.activeQuestId);
  const setActiveQuest = useGameStore((s) => s.setActiveQuest);
  const setMenu = useGameStore((s) => s.setMenu);

  const [selectedId, setSelectedId] = useState<string | null>(activeQuestId);

  const { campaign, side } = useMemo(() => {
    const all = Object.values(QUESTS);
    return {
      campaign: all
        .filter((q) => q.type === 'main')
        .sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0)),
      side: all.filter((q) => q.type === 'side').sort((a, b) => a.level - b.level),
    };
  }, []);

  const selected = selectedId ? QUESTS[selectedId] : undefined;
  const selectedState = selectedId ? quests[selectedId] : undefined;

  const row = (id: string) => {
    const q = QUESTS[id]!;
    const st = quests[id];
    const status = st?.status ?? 'unknown';
    const g = STATUS_GLYPH[status]!;
    const isTracked = activeQuestId === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setSelectedId(id)}
        className={`flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left transition-colors ${
          selectedId === id
            ? 'border-l-phosphor bg-stone/70 text-bone'
            : 'border-l-transparent text-bone-dim hover:bg-stone/40'
        }`}
      >
        <span className={g.className}>{g.glyph}</span>
        <span className="min-w-0 flex-1 truncate text-[12px]">{q.name}</span>
        {isTracked && <span className="micro text-phosphor">TRACKED</span>}
      </button>
    );
  };

  return (
    <MenuShell title="THE SAGAS" rune="ᛋ" keyHint="J" onClose={() => setMenu('none')} width="w-[min(96vw,940px)]">
      <div className="flex min-h-[420px]">
        {/* list */}
        <div className="w-[300px] flex-none overflow-y-auto border-r border-iron p-3">
          <div className="micro mb-1 flex items-center gap-2 text-ash">
            <Scroll size={11} /> THE NINE-REALM THREAD
          </div>
          {campaign.map((q) => row(q.id))}
          <div className="micro mb-1 mt-4 text-ash">SIDE SAGAS</div>
          {side.map((q) => row(q.id))}
        </div>

        {/* detail */}
        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          {selected ? (
            <div>
              <div className="flex flex-wrap items-baseline gap-3">
                <h3 className="font-norse text-lg text-bone">{selected.name}</h3>
                <span className={`micro ${STATUS_GLYPH[selectedState?.status ?? 'unknown']!.className}`}>
                  {STATUS_GLYPH[selectedState?.status ?? 'unknown']!.label}
                </span>
              </div>
              <div className="micro mt-1 text-ash">
                {selected.type === 'main' ? `CHAPTER ${selected.chapter}` : 'SIDE SAGA'} ·{' '}
                {REALMS[selected.realm].displayName.toUpperCase()} · GIVER:{' '}
                {NPCS[selected.giverId]?.name ?? selected.giverId} · LVL {selected.level}
              </div>
              <p className="mt-3 text-[13px] italic leading-relaxed text-bone-dim">
                {selected.summary}
              </p>

              {/* objectives */}
              <div className="mt-4">
                <div className="micro mb-1 text-ash">OBJECTIVES</div>
                {selected.objectives.map((obj) => {
                  const st = selectedState?.objectives.find((o) => o.objectiveId === obj.id);
                  const done = st?.done ?? false;
                  return (
                    <div key={obj.id} className="flex items-baseline gap-2 py-0.5">
                      <span className={done ? 'text-soul' : 'text-phosphor'}>
                        {done ? '■' : '□'}
                      </span>
                      <span
                        className={`flex-1 text-[12px] ${done ? 'text-ash line-through' : 'text-bone-dim'}`}
                      >
                        {obj.text}
                      </span>
                      {obj.qty > 1 && (
                        <span className="stat text-[11px] text-phosphor">
                          {st?.current ?? 0}/{obj.qty}
                        </span>
                      )}
                    </div>
                  );
                })}
                {!selectedState && (
                  <p className="micro mt-1 text-ash">
                    NOT BEGUN — SPEAK TO {NPCS[selected.giverId]?.name.toUpperCase() ?? 'THE GIVER'}
                  </p>
                )}
              </div>

              {/* branch */}
              {selected.branch && (
                <div className="mt-4 border border-iron/70 bg-abyss/40 p-3">
                  <div className="micro mb-1 text-galdr">A CHOICE OF THREADS</div>
                  <p className="text-[12px] italic text-bone-dim">{selected.branch.prompt}</p>
                  {selected.branch.options.map((opt) => {
                    const chosen = selectedState?.choices[selected.branch!.id] === opt.id;
                    const decided = selectedState?.choices[selected.branch!.id] !== undefined;
                    return (
                      <div key={opt.id} className="mt-1 flex items-baseline gap-2">
                        <span className={chosen ? 'text-phosphor' : 'text-iron-2'}>
                          {chosen ? 'ᛝ' : '·'}
                        </span>
                        <span
                          className={`text-[12px] ${
                            chosen ? 'text-phosphor' : decided ? 'text-ash' : 'text-bone-dim'
                          }`}
                        >
                          {opt.text}
                          {chosen && (
                            <span className="micro ml-2 text-ash">PATH CHOSEN — {opt.outcomeText}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* rewards */}
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
                <span className="stat text-[11px] text-soul">{selected.rewards.xp} XP</span>
                <span className="stat text-[11px] text-phosphor">
                  {selected.rewards.gold} HACKSILVER
                </span>
                {selected.rewards.items?.map((r) => (
                  <span key={r.itemId} className="stat text-[11px] text-bone-dim">
                    {ITEMS[r.itemId]?.name ?? r.itemId} ×{r.qty}
                  </span>
                ))}
                {selected.rewards.skillPoints ? (
                  <span className="stat text-[11px] text-galdr">
                    +{selected.rewards.skillPoints} SKILL RUNE
                  </span>
                ) : null}
                {selected.rewards.unlockRealmAbility && (
                  <span className="stat text-[11px] text-galdr">
                    ᚱ {REALM_ABILITIES[selected.rewards.unlockRealmAbility]?.name ?? 'REALM ABILITY'}
                  </span>
                )}
                {selected.rewards.unlockRealm && (
                  <span className="stat text-[11px] text-ice">
                    ᛒ OPENS {REALMS[selected.rewards.unlockRealm].displayName.toUpperCase()}
                  </span>
                )}
              </div>

              {selectedState?.status === 'active' && (
                <div className="mt-4">
                  <MenuAction
                    label={activeQuestId === selected.id ? 'UNTRACK' : 'TRACK'}
                    onClick={() =>
                      setActiveQuest(activeQuestId === selected.id ? null : selected.id)
                    }
                  />
                </div>
              )}
            </div>
          ) : (
            <p className="font-norse text-sm text-ash">Choose a saga to read its thread.</p>
          )}
        </div>
      </div>
    </MenuShell>
  );
}
