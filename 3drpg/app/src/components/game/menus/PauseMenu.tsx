// ============================================================================
// CORESAPIAN — Pause menu (game.md S5): resume / character / skills / sagas /
// map / settings / leave-to-title (with confirm). Header carries link state
// + build stamp.
// ============================================================================

import { useState } from 'react';
import { useNavigate } from 'react-router';

import { BUILD_VERSION } from '@/lib/buildInfo';
import { useGameStore } from '@/game/store';
import type { MenuId } from '../../../../contracts/types';
import { MenuShell } from './menuShared';

const ITEMS: { id: MenuId | 'resume' | 'quit'; rune: string; label: string; hint?: string }[] = [
  { id: 'resume', rune: 'ᚠ', label: 'RESUME', hint: 'ESC' },
  { id: 'inventory', rune: 'ᛁ', label: 'CHARACTER', hint: 'TAB' },
  { id: 'crafting', rune: 'ᚲ', label: 'CRAFT & FORGE' },
  { id: 'skills', rune: 'ᚷ', label: 'SKILLS', hint: 'K' },
  { id: 'quests', rune: 'ᛋ', label: 'SAGAS', hint: 'J' },
  { id: 'map', rune: 'ᛘ', label: 'MAP', hint: 'M' },
  { id: 'settings', rune: 'ᛖ', label: 'SETTINGS' },
  { id: 'quit', rune: 'ᛏ', label: 'LEAVE TO TITLE' },
];

const STATUS_LINE: Record<string, { dot: string; text: string }> = {
  connecting: { dot: 'bg-phosphor animate-pulse', text: 'CONNECTING TO BIFRÖST' },
  connected: { dot: 'bg-soul', text: 'LINKED TO BIFRÖST' },
  reconnecting: { dot: 'bg-blood animate-pulse', text: 'LINK LOST — RETRYING' },
  disconnected: { dot: 'bg-blood', text: 'OFFLINE — UNRECORDED' },
};

export default function PauseMenu() {
  const setMenu = useGameStore((s) => s.setMenu);
  const status = useGameStore((s) => s.status);
  const displayName = useGameStore((s) => s.displayName);
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const link = STATUS_LINE[status]!;

  const pick = (id: MenuId | 'resume' | 'quit') => {
    if (id === 'resume') setMenu('none');
    else if (id === 'quit') setConfirming(true);
    else setMenu(id);
  };

  return (
    <MenuShell title="THE THREAD HOLDS" rune="ᚦ" keyHint="ESC" onClose={() => setMenu('none')} width="w-[min(92vw,420px)]">
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between border-b border-iron pb-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${link.dot}`} />
            <span className="micro text-bone-dim">{link.text}</span>
          </div>
          <span className="micro text-ash">v{BUILD_VERSION}</span>
        </div>

        <div className="micro mb-2 text-ash">
          {displayName.toUpperCase()} — WANDERER OF THE NINE
        </div>

        <nav className="flex flex-col">
          {ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => pick(item.id)}
              className={`group flex items-center gap-3 border-l-2 border-l-transparent px-3 py-2.5 text-left transition-all hover:border-l-phosphor hover:bg-stone/60 ${
                item.id === 'quit' ? 'text-blood-hi' : 'text-bone'
              }`}
            >
              <span className="font-runic w-5 text-center text-sm text-iron-2 transition-colors group-hover:text-phosphor">
                {item.rune}
              </span>
              <span className="flex-1 text-[13px] tracking-[0.18em]">{item.label}</span>
              {item.hint && <span className="micro text-ash">{item.hint}</span>}
            </button>
          ))}
        </nav>

        {confirming && (
          <div className="mt-4 border border-blood/50 bg-abyss/60 p-4">
            <p className="font-norse text-sm text-bone">
              Leave the Nine Realms and return to the title stone?
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="border border-blood px-3 py-1.5 text-[11px] tracking-[0.14em] text-blood-hi transition-colors hover:bg-blood/20"
              >
                LEAVE
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="border border-iron px-3 py-1.5 text-[11px] tracking-[0.14em] text-bone-dim transition-colors hover:border-phosphor hover:text-phosphor"
              >
                STAY
              </button>
            </div>
          </div>
        )}
      </div>
    </MenuShell>
  );
}
