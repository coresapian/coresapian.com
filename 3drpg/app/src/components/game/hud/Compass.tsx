// ============================================================================
// CORESAPIAN — Compass strip (game.md S3 top-center): cardinal runes
// ᚾ ᛖ ᛋ ᚹ sliding with heading, 15° tick marks, quest diamond (phosphor),
// portal diamonds (realm accent), center ▽ marker.
// Heading/position come from the engine probe (degrades to north-centered).
// ============================================================================

import { useMemo } from 'react';

import { QUESTS } from '../../../../contracts/quests';
import { REALMS } from '../../../../contracts/realms';
import type { Vec3 } from '../../../../contracts/types';
import { useGameStore } from '@/game/store';
import { isRealmUnlocked, useCurrentRealm } from '../realmState';
import type { EngineProbe } from './probe';

const WINDOW_DEG = 60;
const STRIP_PX = 420;

const CARDINALS: { deg: number; rune: string }[] = [
  { deg: 0, rune: 'ᚾ' },
  { deg: 90, rune: 'ᛖ' },
  { deg: 180, rune: 'ᛋ' },
  { deg: 270, rune: 'ᚹ' },
];

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function relDeg(bearing: number, heading: number): number {
  return ((bearing - heading + 540) % 360) - 180;
}

function bearingTo(from: Vec3, to: Vec3): number {
  return norm360((Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI);
}

function xFor(rel: number): number {
  return STRIP_PX / 2 + rel * (STRIP_PX / (WINDOW_DEG * 2));
}

interface Marker {
  key: string;
  bearing: number;
  glyph: string;
  className: string;
  title: string;
}

export default function Compass({ probe }: { probe: EngineProbe }) {
  const realm = useCurrentRealm();
  const activeQuestId = useGameStore((s) => s.activeQuestId);
  const quests = useGameStore((s) => s.quests);

  const heading = norm360((-probe.yaw * 180) / Math.PI);

  const markers = useMemo<Marker[]>(() => {
    if (!probe.pos) return [];
    const out: Marker[] = [];
    // Quest waypoint — first undone objective that carries a position.
    const quest = activeQuestId ? QUESTS[activeQuestId] : undefined;
    const qState = activeQuestId ? quests[activeQuestId] : undefined;
    if (quest && qState) {
      for (const obj of quest.objectives) {
        if (!obj.position) continue;
        const st = qState.objectives.find((o) => o.objectiveId === obj.id);
        if (st?.done) continue;
        out.push({
          key: `quest-${obj.id}`,
          bearing: bearingTo(probe.pos!, obj.position),
          glyph: '◆',
          className: 'text-phosphor',
          title: obj.text,
        });
        break;
      }
    }
    // Portals of the current realm (active only toward unlocked realms).
    for (const portal of REALMS[realm].portals) {
      if (!isRealmUnlocked(portal.to, quests)) continue;
      out.push({
        key: `portal-${portal.to}`,
        bearing: bearingTo(probe.pos!, portal.offset),
        glyph: '◆',
        className: 'text-ice',
        title: `${portal.label} → ${REALMS[portal.to].displayName}`,
      });
    }
    return out;
  }, [probe.pos, activeQuestId, quests, realm]);

  return (
    <div className="pointer-events-none relative h-9 w-[420px] overflow-hidden border-y border-iron bg-abyss/60">
      {/* ticks every 15° */}
      {Array.from({ length: 25 }, (_, i) => {
        const deg = i * 15;
        const rel = relDeg(deg, heading);
        if (Math.abs(rel) > WINDOW_DEG) return null;
        return (
          <span
            key={deg}
            className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-iron-2/80"
            style={{ left: xFor(rel) }}
          />
        );
      })}
      {/* cardinal runes */}
      {CARDINALS.map(({ deg, rune }) => {
        const rel = relDeg(deg, heading);
        if (Math.abs(rel) > WINDOW_DEG) return null;
        return (
          <span
            key={deg}
            className="font-runic absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm text-bone"
            style={{ left: xFor(rel) }}
          >
            {rune}
          </span>
        );
      })}
      {/* quest + portal markers */}
      {markers.map((m) => {
        const rel = relDeg(m.bearing, heading);
        if (Math.abs(rel) > WINDOW_DEG) return null;
        return (
          <span
            key={m.key}
            title={m.title}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px] ${m.className}`}
            style={{ left: xFor(rel) }}
          >
            {m.glyph}
          </span>
        );
      })}
      {/* center marker */}
      <span className="absolute left-1/2 top-0 -translate-x-1/2 text-[10px] leading-none text-phosphor">
        ▽
      </span>
      {/* edge fades */}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-abyss to-transparent" />
      <span className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-abyss to-transparent" />
    </div>
  );
}
