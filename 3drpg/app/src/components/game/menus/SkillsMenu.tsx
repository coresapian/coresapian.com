// ============================================================================
// CORESAPIAN — Skills (game.md S7): three branch trees from contracts
// SKILL_BRANCHES/SKILL_NODES with requires links drawn as SVG lines, spend
// via store.spendSkillPoint; realm abilities strip (9 sigils).
// ============================================================================

import { useMemo, useState } from 'react';

import type { SkillBranch, SkillEffect, SkillNode } from '../../../../contracts/skills';
import { REALM_ABILITIES, SKILL_BRANCHES, SKILL_NODES } from '../../../../contracts/skills';
import { useGameStore } from '@/game/store';
import { REALM_RUNES } from '../realmState';
import { MenuAction, MenuShell } from './menuShared';

const BRANCH_ORDER: SkillBranch[] = ['warrior', 'hunter', 'seidr'];
const BRANCH_RUNE: Record<SkillBranch, string> = { warrior: 'ᚺ', hunter: 'ᚠ', seidr: 'ᚷ' };
const GLYPHS = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ', 'ᛁ', 'ᛋ'];

const NODE_R = 22;
const COL_W = 108;
const ROW_H = 72;
const PAD = 30;

function effectLine(e: SkillEffect): string {
  const stat = e.stat.replace(/([A-Z])/g, ' $1').toUpperCase();
  return e.op === 'add' ? `+${e.perRank} ${stat} / RANK` : `×${e.perRank} ${stat} / RANK`;
}

interface Placed {
  node: SkillNode;
  tier: number;
  row: number;
  x: number;
  y: number;
}

export default function SkillsMenu() {
  const skills = useGameStore((s) => s.skills);
  const skillPoints = useGameStore((s) => s.skillPoints);
  const realmAbilities = useGameStore((s) => s.realmAbilities);
  const spendSkillPoint = useGameStore((s) => s.spendSkillPoint);
  const setMenu = useGameStore((s) => s.setMenu);

  const [branch, setBranch] = useState<SkillBranch>('warrior');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Layout: tier = 1 + max(required tiers); rows fill top-down per tier.
  const placed = useMemo<Placed[]>(() => {
    const ids = SKILL_BRANCHES[branch].nodeIds;
    const tiers = new Map<string, number>();
    const tierOf = (id: string, depth: number): number => {
      const cached = tiers.get(id);
      if (cached !== undefined) return cached;
      if (depth > 8) return 0;
      const node = SKILL_NODES[id];
      if (!node || node.requires.length === 0) {
        tiers.set(id, 0);
        return 0;
      }
      const t = 1 + Math.max(...node.requires.map((r) => tierOf(r, depth + 1)));
      tiers.set(id, t);
      return t;
    };
    const perTier = new Map<number, number>();
    return ids.map((id) => {
      const node = SKILL_NODES[id]!;
      const tier = tierOf(id, 0);
      const row = perTier.get(tier) ?? 0;
      perTier.set(tier, row + 1);
      return {
        node,
        tier,
        row,
        x: PAD + tier * COL_W + NODE_R,
        y: PAD + row * ROW_H + NODE_R,
      };
    });
  }, [branch]);

  const width = PAD * 2 + (Math.max(...placed.map((p) => p.tier), 0) + 1) * COL_W;
  const height = PAD * 2 + (Math.max(...placed.map((p) => p.row), 0) + 1) * ROW_H;
  const byId = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);

  const selected = selectedId ? SKILL_NODES[selectedId] : undefined;
  const selectedRank = selectedId ? (skills[selectedId] ?? 0) : 0;
  const canLearn = (node: SkillNode): { ok: boolean; reason: string | null } => {
    const rank = skills[node.id] ?? 0;
    if (rank >= node.maxRank) return { ok: false, reason: 'MASTERED' };
    const unmet = node.requires.filter((r) => (skills[r] ?? 0) < 1);
    if (unmet.length > 0)
      return { ok: false, reason: `REQUIRES ${unmet.map((r) => SKILL_NODES[r]?.name ?? r).join(', ')}` };
    if (skillPoints < node.costPerRank) return { ok: false, reason: 'NO SKILL RUNES' };
    return { ok: true, reason: null };
  };

  return (
    <MenuShell title="WYRD & SKILL" rune="ᚷ" keyHint="K" onClose={() => setMenu('none')} width="w-[min(96vw,980px)]">
      <div className="p-5">
        {/* header: points + branch tabs */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="chip border-phosphor/60 text-phosphor">
            ᚱ {skillPoints} SKILL RUNE{skillPoints === 1 ? '' : 'S'}
          </span>
          <div className="ml-auto flex gap-1">
            {BRANCH_ORDER.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => {
                  setBranch(b);
                  setSelectedId(null);
                }}
                className={`border px-3 py-1.5 text-[11px] tracking-[0.12em] transition-colors ${
                  branch === b
                    ? 'border-phosphor text-phosphor'
                    : 'border-iron text-bone-dim hover:border-phosphor/50 hover:text-bone'
                }`}
              >
                <span className="font-runic mr-1">{BRANCH_RUNE[b]}</span>
                {SKILL_BRANCHES[b].name.toUpperCase()}
                <span className="ml-1 text-ash">{SKILL_BRANCHES[b].oldNorse}</span>
              </button>
            ))}
          </div>
        </div>

        {/* tree */}
        <div className="relative overflow-x-auto border border-iron bg-abyss/40">
          <div className="relative" style={{ width, height }}>
            <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
              {placed.flatMap((p) =>
                p.node.requires.map((reqId) => {
                  const from = byId.get(reqId);
                  if (!from) return null;
                  const lit = (skills[reqId] ?? 0) > 0;
                  return (
                    <line
                      key={`${reqId}-${p.node.id}`}
                      x1={from.x}
                      y1={from.y}
                      x2={p.x}
                      y2={p.y}
                      stroke={lit ? 'var(--phosphor)' : 'var(--iron-2)'}
                      strokeWidth={lit ? 1.5 : 1}
                      strokeDasharray={lit ? undefined : '3 4'}
                      opacity={lit ? 0.8 : 0.6}
                    />
                  );
                }),
              )}
            </svg>
            {placed.map((p, i) => {
              const rank = skills[p.node.id] ?? 0;
              const gate = canLearn(p.node);
              const learned = rank > 0;
              const isSel = selectedId === p.node.id;
              return (
                <button
                  key={p.node.id}
                  type="button"
                  onClick={() => setSelectedId(isSel ? null : p.node.id)}
                  title={p.node.name}
                  className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border transition-all ${
                    isSel
                      ? 'border-phosphor text-phosphor shadow-[0_0_14px_rgb(var(--phosphor-rgb)/0.4)]'
                      : learned
                        ? 'border-phosphor/70 text-phosphor'
                        : gate.ok
                          ? 'border-bone/60 text-bone hover:border-phosphor'
                          : 'border-iron-2 text-iron-2'
                  } bg-stone`}
                  style={{ left: p.x, top: p.y, width: NODE_R * 2, height: NODE_R * 2 }}
                >
                  <span className="font-runic text-base leading-none">{GLYPHS[i % GLYPHS.length]}</span>
                  <span className="stat text-[8px] leading-none">
                    {rank}/{p.node.maxRank}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* node detail */}
        <div className="mt-3 min-h-[96px] border border-iron bg-abyss/50 p-4">
          {selected ? (
            <div>
              <div className="flex items-baseline gap-3">
                <span className="font-norse text-base text-bone">{selected.name}</span>
                <span className="micro text-ash">
                  RANK {selectedRank}/{selected.maxRank} · COST {selected.costPerRank} RUNE
                  {selected.costPerRank > 1 ? 'S' : ''}
                </span>
              </div>
              <p className="mt-1 text-[12px] italic text-bone-dim">{selected.description}</p>
              <div className="mt-1 flex flex-wrap gap-x-4">
                {selected.effects.map((e, i) => (
                  <span key={i} className="stat text-[11px] text-galdr">
                    {effectLine(e)}
                  </span>
                ))}
              </div>
              {selected.requires.length > 0 && (
                <div className="micro mt-1 text-ash">
                  REQUIRES:{' '}
                  {selected.requires
                    .map((r) => {
                      const met = (skills[r] ?? 0) > 0;
                      return `${SKILL_NODES[r]?.name ?? r}${met ? ' ✓' : ''}`;
                    })
                    .join(' · ')}
                </div>
              )}
              <div className="mt-2">
                <MenuAction
                  label={selectedRank > 0 ? 'DEEPEN' : 'LEARN'}
                  disabled={!canLearn(selected).ok}
                  title={canLearn(selected).reason ?? 'Spend a skill rune'}
                  onClick={() => spendSkillPoint(selected.id)}
                />
              </div>
            </div>
          ) : (
            <p className="font-norse text-sm text-ash">
              Choose a rune from the tree to study it.
            </p>
          )}
        </div>

        {/* realm abilities strip */}
        <div className="mt-4">
          <div className="micro mb-2 text-ash">REALM ABILITIES — EARNED BY CHAPTER</div>
          <div className="grid grid-cols-9 gap-1.5">
            {Object.values(REALM_ABILITIES).map((ra) => {
              const unlocked = realmAbilities.includes(ra.id);
              return (
                <div
                  key={ra.id}
                  title={`${ra.name} (${ra.oldNorse}) — ${ra.description}`}
                  className={`flex h-14 flex-col items-center justify-center border ${
                    unlocked
                      ? 'border-phosphor/60 bg-stone/80 text-phosphor'
                      : 'border-iron/60 bg-abyss/40 text-iron-2'
                  }`}
                >
                  <span className={`font-runic text-lg leading-none ${unlocked ? '' : 'opacity-40'}`}>
                    {REALM_RUNES[ra.realm]}
                  </span>
                  <span className="micro mt-0.5 text-[7px]">{ra.name.toUpperCase()}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </MenuShell>
  );
}
