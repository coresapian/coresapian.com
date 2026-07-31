// ============================================================================
// CORESAPIAN — Dialogue panel (game.md S13; gdd §8.4). Renders the store
// Dialogue slice: speaker in Uncial, boot-type text reveal, choice buttons
// with requirement tags + consequence hints, branch options flagged.
// ui triggers advance/close; the rpg-quests runtime executes quest/faction/
// item effects — ui only honors `open_shop` (the shop is ui-rendered).
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

import type { DialogueChoice, DialogueEffect } from '../../../contracts/quests';
import { DIALOGUE_TREES, NPCS } from '../../../contracts/quests';
import { useGameStore } from '@/game/store';
import { useUiAux } from './uiAux';

const TYPE_MS = 14;

function effectHint(effect: DialogueEffect): string | null {
  switch (effect.type) {
    case 'open_shop':
      return 'OPENS WARES';
    case 'start_quest':
      return 'NEW SAGA';
    case 'advance_quest':
      return 'THE SAGA ADVANCES';
    case 'choose_branch':
      return 'A CHOICE OF THREADS';
    case 'give_item':
      return 'A GIFT';
    case 'faction':
      return 'STANDING SHIFTS';
    case 'heal':
      return 'MENDING';
    default:
      return null;
  }
}

export default function DialoguePanel() {
  const session = useGameStore((s) => s.active);
  const quests = useGameStore((s) => s.quests);
  const level = useGameStore((s) => s.level);
  const advanceDialogue = useGameStore((s) => s.advanceDialogue);
  const closeDialogue = useGameStore((s) => s.closeDialogue);
  const openShop = useUiAux((s) => s.openShop);

  const npc = session ? NPCS[session.npcId] : undefined;
  const tree = session ? DIALOGUE_TREES[session.treeId] : undefined;
  const node = session && tree ? tree.nodes[session.nodeId] : undefined;

  // Boot-type reveal of the node text; resets on node change.
  const fullText = node?.text ?? '';
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    if (!fullText) return;
    const id = window.setInterval(() => {
      setShown((n) => {
        if (n >= fullText.length) {
          window.clearInterval(id);
          return n;
        }
        return n + 2;
      });
    }, TYPE_MS);
    return () => window.clearInterval(id);
  }, [fullText]);
  const typing = shown < fullText.length;

  const choiceGate = useMemo(
    () =>
      (c: DialogueChoice): { ok: boolean; tag: string | null } => {
        const cond = c.condition;
        if (!cond) return { ok: true, tag: null };
        if (cond.minLevel !== undefined && level < cond.minLevel)
          return { ok: false, tag: `LVL ${cond.minLevel}` };
        if (cond.questActive !== undefined && quests[cond.questActive]?.status !== 'active')
          return { ok: false, tag: 'THREAD NOT BEGUN' };
        if (cond.questComplete !== undefined && quests[cond.questComplete]?.status !== 'completed')
          return { ok: false, tag: 'THREAD UNSPUN' };
        return { ok: true, tag: null };
      },
    [level, quests],
  );

  const pick = (c: DialogueChoice) => {
    if (!choiceGate(c).ok) return;
    // ui-owned effect: open the shop panel (quest/faction/item effects are
    // executed by the rpg-quests runtime watching the dialogue session).
    for (const effect of c.effects ?? []) {
      if (effect.type === 'open_shop' && session) openShop(session.npcId, effect.shopId);
    }
    if (c.next === null) closeDialogue();
    else advanceDialogue(c.next);
  };

  // Keyboard: 1–4 choose, Space/Enter completes typing / advances a lone
  // choice. (E stays engine-owned interact — ui must not double-bind it.)
  useEffect(() => {
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '1' && e.key <= '4') {
        const c = node.choices[Number(e.key) - 1];
        if (c) pick(c);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (typing) setShown(fullText.length);
        else if (node.choices.length === 1) pick(node.choices[0]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, typing, fullText, level, quests, session]);

  if (!session || !npc || !node) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center pb-6">
      <div className="panel pointer-events-auto w-[min(94vw,720px)]">
        {/* speaker header */}
        <div className="flex items-center gap-3 border-b border-iron px-5 py-2.5">
          <span className="font-runic flex h-9 w-9 items-center justify-center border border-phosphor/50 text-lg text-phosphor">
            {npc.name.charAt(0)}
          </span>
          <div>
            <div className="font-norse text-base text-bone">{npc.name}</div>
            <div className="micro text-ash">
              {npc.role.toUpperCase()} · {npc.realm.toUpperCase()}
            </div>
          </div>
          <button
            type="button"
            onClick={closeDialogue}
            aria-label="End conversation"
            className="ml-auto flex h-7 w-7 items-center justify-center border border-iron text-ash transition-colors hover:border-blood hover:text-blood-hi"
          >
            <X size={13} />
          </button>
        </div>

        {/* node text — click to complete the reveal */}
        <button
          type="button"
          onClick={() => typing && setShown(fullText.length)}
          className="block w-full cursor-pointer px-5 py-4 text-left"
        >
          <p className="font-norse min-h-[64px] text-[15px] leading-relaxed text-bone">
            {fullText.slice(0, shown)}
            {typing && <span className="boot-caret">▊</span>}
          </p>
        </button>

        {/* choices */}
        {!typing && (
          <div className="flex flex-col gap-1 border-t border-iron/60 px-5 py-3">
            {node.choices.map((c, i) => {
              const gate = choiceGate(c);
              const hints = (c.effects ?? []).map(effectHint).filter(Boolean);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!gate.ok}
                  onClick={() => pick(c)}
                  className={`group flex items-baseline gap-3 px-2 py-1.5 text-left transition-colors ${
                    gate.ok ? 'hover:bg-stone/60' : 'cursor-not-allowed opacity-45'
                  }`}
                >
                  <span className="stat w-4 flex-none text-[11px] text-ash group-hover:text-phosphor">
                    {i + 1}
                  </span>
                  <span
                    className={`flex-1 text-[13px] ${
                      gate.ok ? 'text-bone-dim group-hover:text-bone' : 'text-ash'
                    }`}
                  >
                    {c.text}
                  </span>
                  {gate.tag && <span className="micro flex-none text-blood-hi">[{gate.tag}]</span>}
                  {hints.map((h) => (
                    <span key={h} className="micro flex-none text-galdr">
                      [{h}]
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
