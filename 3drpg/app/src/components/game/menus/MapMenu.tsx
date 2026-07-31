// ============================================================================
// CORESAPIAN — Realm map (game.md S10): world-tree diagram of the nine
// realms from contracts REALMS — unlock state (quest chapter rewards),
// current-realm highlight, portal exits. No 3D needed.
// ============================================================================

import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';

import { REALMS, realmTier } from '../../../../contracts/realms';
import type { RealmId } from '../../../../contracts/types';
import { REALM_IDS } from '../../../../contracts/types';
import { useGameStore } from '@/game/store';
import { REALM_RUNES, isRealmUnlocked, useCurrentRealm } from '../realmState';
import { MenuShell } from './menuShared';

const CX = 260;
const CY = 230;
const RADIUS = 168;

export default function MapMenu() {
  const current = useCurrentRealm();
  const quests = useGameStore((s) => s.quests);
  const setMenu = useGameStore((s) => s.setMenu);
  const [selected, setSelected] = useState<RealmId>(current);

  // Ring order: unlock order (tier) so the tree reads bottom → top.
  const ring = useMemo(
    () => [...REALM_IDS].sort((a, b) => realmTier(a) - realmTier(b)),
    [],
  );
  const pos = useMemo(() => {
    const map = new Map<RealmId, { x: number; y: number }>();
    ring.forEach((id, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / ring.length;
      map.set(id, {
        x: CX + Math.cos(angle) * RADIUS,
        y: CY + Math.sin(angle) * RADIUS * 0.86,
      });
    });
    return map;
  }, [ring]);

  const sel = REALMS[selected];
  const selUnlocked = isRealmUnlocked(selected, quests);

  return (
    <MenuShell title="YGGDRASIL — THE NINE" rune="ᛘ" keyHint="M" onClose={() => setMenu('none')} width="w-[min(96vw,980px)]">
      <div className="flex">
        {/* tree diagram */}
        <div className="relative h-[460px] w-[520px] flex-none">
          <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
            {ring.map((id) => {
              const p = pos.get(id)!;
              const lit = isRealmUnlocked(id, quests);
              return (
                <line
                  key={id}
                  x1={CX}
                  y1={CY}
                  x2={p.x}
                  y2={p.y}
                  stroke={lit ? 'var(--iron-2)' : 'var(--iron)'}
                  strokeWidth={id === selected ? 2 : 1}
                  strokeDasharray={lit ? undefined : '2 5'}
                />
              );
            })}
          </svg>
          {/* the world-tree heart */}
          <div className="absolute flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-phosphor/50 bg-abyss" style={{ left: CX, top: CY }}>
            <span className="font-runic text-xl text-phosphor">ᛘ</span>
          </div>
          {ring.map((id) => {
            const p = pos.get(id)!;
            const unlocked = isRealmUnlocked(id, quests);
            const isCurrent = id === current;
            const isSel = id === selected;
            const cfg = REALMS[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelected(id)}
                title={cfg.displayName}
                className={`absolute flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border bg-stone transition-all ${
                  isSel
                    ? 'border-phosphor shadow-[0_0_16px_rgb(var(--phosphor-rgb)/0.35)]'
                    : unlocked
                      ? 'border-iron-2 hover:border-phosphor/60'
                      : 'border-iron/60 opacity-50'
                } ${isCurrent ? 'animate-[glow-breathe_2s_ease-in-out_infinite]' : ''}`}
                style={{ left: p.x, top: p.y }}
              >
                <span className="font-runic text-lg leading-none" style={{ color: unlocked ? cfg.palette.accent : 'var(--iron-2)' }}>
                  {REALM_RUNES[id]}
                </span>
                {!unlocked && <Lock size={9} className="text-iron-2" />}
                {isCurrent && <span className="absolute -bottom-4 whitespace-nowrap text-[8px] tracking-[0.2em] text-phosphor">YOU STAND HERE</span>}
              </button>
            );
          })}
        </div>

        {/* realm detail */}
        <div className="min-w-0 flex-1 border-l border-iron p-5">
          <div className="flex items-baseline gap-3">
            <h3 className="font-display text-lg font-black uppercase tracking-[0.16em] text-bone">
              {sel.displayName}
            </h3>
            <span className="font-norse text-sm text-ash">{sel.oldNorse}</span>
          </div>
          <div className="micro mt-1 text-ash">
            TIER {sel.tier} · THREAT {sel.tier <= 2 ? 'LOW' : sel.tier <= 4 ? 'MEASURED' : sel.tier <= 6 ? 'HIGH' : 'SEVERE'} ·{' '}
            {selUnlocked ? (
              <span className="text-soul">THE WAY STANDS OPEN</span>
            ) : (
              <span className="text-blood-hi">SEALED</span>
            )}
          </div>
          <p className="mt-3 text-[13px] italic leading-relaxed text-bone-dim">{sel.description}</p>

          <div className="mt-4">
            <div className="micro mb-1 text-ash">DENIZEN OF THE DEEP</div>
            <span className="font-norse text-sm text-blood-hi">{sel.bossName}</span>
          </div>

          {selUnlocked && sel.portals.length > 0 && (
            <div className="mt-4">
              <div className="micro mb-1 text-ash">WAYS OUT</div>
              {sel.portals.map((portal) => {
                const open = isRealmUnlocked(portal.to, quests);
                return (
                  <div key={portal.to} className="flex items-center gap-2 py-0.5 text-[12px]">
                    <span className={open ? 'text-ice' : 'text-iron-2'}>◆</span>
                    <span className={open ? 'text-bone-dim' : 'text-ash'}>
                      {portal.label} → {REALMS[portal.to].displayName}
                    </span>
                    {!open && <span className="micro text-blood-hi">SEALED</span>}
                  </div>
                );
              })}
            </div>
          )}

          {!selUnlocked && (
            <div className="mt-4 border border-iron/70 bg-abyss/40 p-3">
              <div className="micro text-ash">
                THE WAY OPENS WHEN THE THREAD OF{' '}
                <span className="text-bone">
                  {REALMS[selected].chapterQuestId &&
                    (quests[REALMS[selected].chapterQuestId]?.status === 'completed'
                      ? 'ANOTHER REALM'
                      : 'THE CAMPAIGN')}
                </span>{' '}
                IS SPUN — FOLLOW THE SAGAS (J).
              </div>
            </div>
          )}
        </div>
      </div>
    </MenuShell>
  );
}
