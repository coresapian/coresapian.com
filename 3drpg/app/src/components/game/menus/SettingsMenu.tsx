// ============================================================================
// CORESAPIAN — Settings (game.md S11): mouse sens, invert Y, FOV, volumes,
// quality, CRT intensity (localStorage coresapian.crt + coresapian:crt event
// — the frozen Layout CrtOverlay listens), showFps. Store fields go through
// updateSettings. Controls table = locked defaults (gdd §4).
// ============================================================================

import { useState } from 'react';

import { useGameStore, useSettings } from '@/game/store';
import type { QualityLevel } from '../../../../contracts/store-api';
import type { CrtLevel } from '../crt';
import { readCrt, writeCrt } from '../crt';
import { MenuShell } from './menuShared';

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 py-1.5">
      <span className="micro w-[168px] flex-none text-bone-dim">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none bg-iron accent-[#FFB64A]"
      />
      <span className="stat w-14 text-right text-[11px] text-phosphor">{format(value)}</span>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 py-1.5 text-left"
    >
      <span className="micro w-[168px] flex-none text-bone-dim">{label}</span>
      <span
        className={`flex h-4 w-8 items-center border px-0.5 transition-colors ${
          checked ? 'justify-end border-phosphor bg-phosphor/20' : 'justify-start border-iron bg-abyss'
        }`}
      >
        <span className={`h-3 w-3 ${checked ? 'bg-phosphor' : 'bg-iron-2'}`} />
      </span>
      <span className="stat text-[11px] text-bone">{checked ? 'ON' : 'OFF'}</span>
    </button>
  );
}

const CONTROLS: [string, string][] = [
  ['W A S D', 'MOVE'],
  ['MOUSE', 'LOOK'],
  ['SHIFT', 'SPRINT'],
  ['SPACE', 'JUMP'],
  ['LMB', 'ATTACK'],
  ['RMB (HOLD)', 'BLOCK / PARRY'],
  ['E', 'INTERACT'],
  ['Q R F V', 'CAST RUNES'],
  ['1–4', 'PROVISIONS'],
  ['C', 'REALM ABILITY'],
  ['TAB', 'PACK & PANOPLY'],
  ['K / J / M', 'SKILLS / SAGAS / MAP'],
  ['ESC', 'PAUSE'],
];

export default function SettingsMenu() {
  const settings = useSettings();
  const updateSettings = useGameStore((s) => s.updateSettings);
  const setMenu = useGameStore((s) => s.setMenu);
  // Game page applies High by default (game.md S11); the user may retune.
  const [crt, setCrtState] = useState<CrtLevel>(() => readCrt('high'));
  const setCrt = (level: CrtLevel) => {
    setCrtState(level);
    writeCrt(level); // only on explicit user action — never on mount
  };

  return (
    <MenuShell title="SETTINGS" rune="ᛖ" keyHint="ESC — BACK" onClose={() => setMenu('pause')} width="w-[min(94vw,620px)]">
      <div className="p-5">
        <div className="micro mb-1 text-ash">HAND & EYE</div>
        <Slider
          label="MOUSE SENSITIVITY"
          value={settings.mouseSensitivity}
          min={0.1}
          max={3}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => updateSettings({ mouseSensitivity: v })}
        />
        <Toggle
          label="INVERT Y"
          checked={settings.invertY}
          onChange={(v) => updateSettings({ invertY: v })}
        />
        <Slider
          label="FIELD OF VIEW"
          value={settings.fov}
          min={60}
          max={110}
          step={1}
          format={(v) => `${v}°`}
          onChange={(v) => updateSettings({ fov: v })}
        />

        <div className="micro mb-1 mt-5 text-ash">CHOIR & CLASH</div>
        <Slider
          label="MASTER VOLUME"
          value={settings.volumeMaster}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => updateSettings({ volumeMaster: v })}
        />
        <Slider
          label="MUSIC VOLUME"
          value={settings.volumeMusic}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => updateSettings({ volumeMusic: v })}
        />
        <Slider
          label="EFFECTS VOLUME"
          value={settings.volumeSfx}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => updateSettings({ volumeSfx: v })}
        />

        <div className="micro mb-1 mt-5 text-ash">THE VEIL</div>
        <div className="flex items-center gap-3 py-1.5">
          <span className="micro w-[168px] flex-none text-bone-dim">QUALITY</span>
          <div className="flex gap-1">
            {(['low', 'medium', 'high'] as QualityLevel[]).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => updateSettings({ quality: q })}
                className={`border px-3 py-1 text-[10px] tracking-[0.14em] transition-colors ${
                  settings.quality === q
                    ? 'border-phosphor text-phosphor'
                    : 'border-iron text-bone-dim hover:border-phosphor/50'
                }`}
              >
                {q.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 py-1.5">
          <span className="micro w-[168px] flex-none text-bone-dim">CRT VEIL INTENSITY</span>
          <div className="flex gap-1">
            {(['off', 'low', 'high'] as CrtLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setCrt(level)}
                className={`border px-3 py-1 text-[10px] tracking-[0.14em] transition-colors ${
                  crt === level
                    ? 'border-phosphor text-phosphor'
                    : 'border-iron text-bone-dim hover:border-phosphor/50'
                }`}
              >
                {level.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <Toggle
          label="SHOW FPS"
          checked={settings.showFps}
          onChange={(v) => updateSettings({ showFps: v })}
        />

        <div className="micro mb-1 mt-5 text-ash">CONTROLS — ETCHED IN STONE</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 border border-iron bg-abyss/40 p-3">
          {CONTROLS.map(([keys, action]) => (
            <div key={keys} className="flex items-baseline justify-between gap-2">
              <span className="stat text-[10px] text-phosphor">{keys}</span>
              <span className="micro text-[9px] text-bone-dim">{action}</span>
            </div>
          ))}
        </div>
      </div>
    </MenuShell>
  );
}
