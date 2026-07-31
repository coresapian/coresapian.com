// ============================================================================
// CORESAPIAN — src/game/audio/sfx.ts (audio-net)
//
// One-shot SFX recipes (audio-recipes.md §4 + §5) dispatched by `play_sfx`
// event sfxId. Positional playback via HRTF PannerNode (inverse distance,
// ref 4m, max 60m); non-positional ids render straight to the sfx bus.
// ============================================================================

import type { Vec3 } from '../../../contracts/types';

import type { AudioEngine, NoiseColor, VoiceHandle } from './engine';
import { vary } from './engine';

// ---------------------------------------------------------------------------
// Shot plumbing
// ---------------------------------------------------------------------------

export interface Shot {
  /** Total tail length in seconds (for voice release). */
  dur: number;
  stop: () => void;
}

interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  q?: number;
  /** Sweep target + time constant (setTargetAtTime τ = sweepT/3). */
  sweepTo?: number;
  sweepT?: number;
}

interface NoiseShotSpec {
  color?: NoiseColor;
  dur: number;
  gain: number;
  a?: number;
  d?: number;
  rate?: number;
  filter?: FilterSpec;
  filter2?: FilterSpec;
  at?: number;
}

interface ToneShotSpec {
  type: OscillatorType;
  freq: number;
  freqEnd?: number;
  freqT?: number;
  dur: number;
  gain: number;
  a?: number;
  d?: number;
  at?: number;
  /** Extra processing chain inserted before the envelope. */
  drive?: number;
  formantSweep?: { from: number; to: number; q?: number; gain?: number };
  /** Post-source filter (e.g. ui.click lp 2500). */
  filter?: FilterSpec;
}

interface BellSpec {
  carrier: number;
  /** Modulator frequency (number) or multiple of carrier (× prefix). */
  mod: number;
  idx0: number;
  idx1: number;
  dur: number;
  gain: number;
  at?: number;
}

function noiseShot(e: AudioEngine, out: AudioNode, spec: NoiseShotSpec): Shot {
  const ac = e.context;
  const buf = e.noiseBuffer(spec.color ?? 'white');
  if (!ac || !buf) return { dur: 0, stop: () => undefined };
  const t = e.t0() + (spec.at ?? 0);

  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = spec.rate ?? 1;

  let head: AudioNode = src;
  const applyFilter = (f: FilterSpec): BiquadFilterNode => {
    const node = ac.createBiquadFilter();
    node.type = f.type;
    node.frequency.setValueAtTime(f.freq, t);
    node.Q.value = f.q ?? 1;
    if (f.sweepTo !== undefined) {
      node.frequency.setTargetAtTime(f.sweepTo, t, Math.max(f.sweepT ?? spec.dur, 0.01) / 3);
    }
    head.connect(node);
    head = node;
    return node;
  };
  if (spec.filter) applyFilter(spec.filter);
  if (spec.filter2) applyFilter(spec.filter2);

  const g = ac.createGain();
  const a = spec.a ?? 0.005;
  const d = spec.d ?? spec.dur;
  e.adsr(g.gain, t, { a, d, s: 0.0001, peak: spec.gain });
  head.connect(g);
  g.connect(out);

  src.start(t);
  const stopAt = t + a + d + 0.35;
  src.stop(stopAt);
  const cleanup = (): void => {
    try {
      g.disconnect();
    } catch {
      /* noop */
    }
  };
  src.onended = cleanup;
  return {
    dur: stopAt - e.now(),
    stop: () => {
      try {
        src.stop();
      } catch {
        /* noop */
      }
      cleanup();
    },
  };
}

function toneShot(e: AudioEngine, out: AudioNode, spec: ToneShotSpec): Shot {
  const ac = e.context;
  if (!ac) return { dur: 0, stop: () => undefined };
  const t = e.t0() + (spec.at ?? 0);

  const osc = ac.createOscillator();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.freq, t);
  if (spec.freqEnd !== undefined) {
    osc.frequency.setTargetAtTime(spec.freqEnd, t, Math.max(spec.freqT ?? spec.dur, 0.01) / 3);
  }

  let head: AudioNode = osc;
  const extraGains: GainNode[] = [];
  if (spec.filter) {
    const f = ac.createBiquadFilter();
    f.type = spec.filter.type;
    f.frequency.setValueAtTime(spec.filter.freq, t);
    f.Q.value = spec.filter.q ?? 1;
    if (spec.filter.sweepTo !== undefined) {
      f.frequency.setTargetAtTime(spec.filter.sweepTo, t, Math.max(spec.filter.sweepT ?? spec.dur, 0.01) / 3);
    }
    head.connect(f);
    head = f;
  }
  if (spec.drive !== undefined) {
    const shaper = ac.createWaveShaper();
    shaper.curve = e.driveCurve(spec.drive);
    head.connect(shaper);
    head = shaper;
  }
  if (spec.formantSweep) {
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(spec.formantSweep.from, t);
    bp.frequency.setTargetAtTime(spec.formantSweep.to, t, spec.dur / 3);
    bp.Q.value = spec.formantSweep.q ?? 6;
    const fg = ac.createGain();
    fg.gain.value = spec.formantSweep.gain ?? 0.6;
    head.connect(bp);
    bp.connect(fg);
    fg.connect(out);
    extraGains.push(fg);
  }

  const g = ac.createGain();
  const a = spec.a ?? 0.005;
  const d = spec.d ?? spec.dur;
  e.adsr(g.gain, t, { a, d, s: 0.0001, peak: spec.gain });
  head.connect(g);
  g.connect(out);

  osc.start(t);
  const stopAt = t + a + d + 0.4;
  osc.stop(stopAt);
  const cleanup = (): void => {
    try {
      g.disconnect();
      extraGains.forEach((fg) => fg.disconnect());
    } catch {
      /* noop */
    }
  };
  osc.onended = cleanup;
  return {
    dur: stopAt - e.now(),
    stop: () => {
      try {
        osc.stop();
      } catch {
        /* noop */
      }
      cleanup();
    },
  };
}

/** FM bell: carrier + modulator with index decay idx0 → idx1. */
function fmBell(e: AudioEngine, out: AudioNode, spec: BellSpec): Shot {
  const ac = e.context;
  if (!ac) return { dur: 0, stop: () => undefined };
  const t = e.t0() + (spec.at ?? 0);

  const car = ac.createOscillator();
  car.type = 'sine';
  car.frequency.value = spec.carrier;
  const mod = ac.createOscillator();
  mod.type = 'sine';
  mod.frequency.value = spec.mod;
  const modGain = ac.createGain();
  modGain.gain.setValueAtTime(spec.mod * spec.idx0, t);
  modGain.gain.setTargetAtTime(spec.mod * spec.idx1, t, Math.max(spec.dur, 0.01) / 3);
  mod.connect(modGain);
  modGain.connect(car.frequency);

  const g = ac.createGain();
  e.adsr(g.gain, t, { a: 0.004, d: spec.dur, s: 0.0001, peak: spec.gain });
  car.connect(g);
  g.connect(out);

  car.start(t);
  mod.start(t);
  const stopAt = t + spec.dur + 0.4;
  car.stop(stopAt);
  mod.stop(stopAt);
  const cleanup = (): void => {
    try {
      g.disconnect();
    } catch {
      /* noop */
    }
  };
  car.onended = cleanup;
  return {
    dur: stopAt - e.now(),
    stop: () => {
      try {
        car.stop();
        mod.stop();
      } catch {
        /* noop */
      }
      cleanup();
    },
  };
}

/** Mini formant pad swell (§3 formant bank, single saw source). */
function formantSwell(
  e: AudioEngine,
  out: AudioNode,
  spec: { vowel: 'a' | 'o' | 'u'; sourceFreq: number; attackS: number; releaseS: number; gain: number; at?: number },
): Shot {
  const FORMANTS: Record<'a' | 'o' | 'u', readonly [number, number, number]> = {
    a: [730, 1090, 2440],
    o: [570, 840, 2410],
    u: [300, 870, 2240],
  };
  const GAINS = [1.0, 0.6, 0.35];
  const ac = e.context;
  if (!ac) return { dur: 0, stop: () => undefined };
  const t = e.t0() + (spec.at ?? 0);

  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = spec.sourceFreq;

  const mix = ac.createGain();
  mix.gain.value = 0.5;
  osc.connect(mix);

  const formants = FORMANTS[spec.vowel];
  const sum = ac.createGain();
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3000;
  sum.connect(lp);

  formants.forEach((freq, i) => {
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 10;
    const fg = ac.createGain();
    fg.gain.value = GAINS[i] ?? 1;
    mix.connect(bp);
    bp.connect(fg);
    fg.connect(sum);
  });

  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.setTargetAtTime(spec.gain, t, Math.max(spec.attackS, 0.01) / 3);
  const tEnd = t + spec.attackS;
  g.gain.setTargetAtTime(0.0001, tEnd, Math.max(spec.releaseS, 0.01) / 3);
  lp.connect(g);
  g.connect(out);

  osc.start(t);
  const stopAt = tEnd + spec.releaseS + 0.6;
  osc.stop(stopAt);
  const cleanup = (): void => {
    try {
      g.disconnect();
    } catch {
      /* noop */
    }
  };
  osc.onended = cleanup;
  return {
    dur: stopAt - e.now(),
    stop: () => {
      try {
        osc.stop();
      } catch {
        /* noop */
      }
      cleanup();
    },
  };
}

function combine(...shots: Shot[]): Shot {
  return {
    dur: shots.reduce((m, s) => Math.max(m, s.dur), 0),
    stop: () => shots.forEach((s) => s.stop()),
  };
}

// ---------------------------------------------------------------------------
// Recipe registry — sfxId → builder (audio-recipes.md §4)
// ---------------------------------------------------------------------------

type Builder = (e: AudioEngine, out: AudioNode) => Shot;

let footstepFlip = 1;

function footstep(surface: 'grass' | 'stone' | 'snow'): Builder {
  return (e, out) => {
    footstepFlip *= -1;
    const rate = 1 + footstepFlip * 0.1; // alternate ±10% pitch
    if (surface === 'grass') {
      return noiseShot(e, out, { dur: 0.06, gain: 0.12, rate, filter: { type: 'bandpass', freq: 900, q: 0.8 } });
    }
    if (surface === 'stone') {
      return combine(
        noiseShot(e, out, { dur: 0.06, gain: 0.14, rate, filter: { type: 'bandpass', freq: 500, q: 1.2 } }),
        noiseShot(e, out, { dur: 0.02, gain: 0.09, rate: rate * 1.4, filter: { type: 'highpass', freq: 2500 } }),
      );
    }
    return noiseShot(e, out, {
      dur: 0.12,
      gain: 0.13,
      rate,
      filter: { type: 'bandpass', freq: 300, q: 0.6 },
      filter2: { type: 'lowpass', freq: 800 },
    });
  };
}

function fleshHit(gain: number, rate: number): Builder {
  return (e, out) =>
    combine(
      noiseShot(e, out, { dur: 0.09, gain, rate, filter: { type: 'lowpass', freq: 900 } }),
      toneShot(e, out, { type: 'sine', freq: 160 * rate, freqEnd: 70 * rate, dur: 0.12, gain }),
    );
}

const BUILDERS: Record<string, Builder> = {
  // ----------------------------------------------------------- movement
  'sfx.footstep.grass': footstep('grass'),
  'sfx.footstep.stone': footstep('stone'),
  'sfx.footstep.snow': footstep('snow'),
  'sfx.jump': (e, out) =>
    noiseShot(e, out, { dur: 0.08, gain: 0.06, filter: { type: 'bandpass', freq: 600, q: 1 } }),
  'sfx.land': (e, out) =>
    combine(
      toneShot(e, out, { type: 'sine', freq: 90, freqEnd: 50, dur: 0.12, gain: 0.2 }),
      noiseShot(e, out, { dur: 0.1, gain: 0.12, filter: { type: 'lowpass', freq: 400 } }),
    ),
  'sfx.dodge': (e, out) =>
    noiseShot(e, out, {
      dur: 0.18,
      gain: 0.09,
      filter: { type: 'bandpass', freq: 500, q: 1, sweepTo: 900, sweepT: 0.18 },
    }),

  // ------------------------------------------------------------- combat
  'sfx.swing.light': (e, out) =>
    noiseShot(e, out, {
      dur: 0.15,
      gain: 0.12,
      rate: vary(0.08),
      filter: { type: 'bandpass', freq: 400, q: 2, sweepTo: 1800, sweepT: 0.15 },
    }),
  'sfx.swing.heavy': (e, out) =>
    combine(
      noiseShot(e, out, {
        dur: 0.28,
        gain: 0.16,
        rate: vary(0.08),
        filter: { type: 'bandpass', freq: 250, q: 2, sweepTo: 1200, sweepT: 0.28 },
      }),
      toneShot(e, out, { type: 'sine', freq: 70, dur: 0.2, gain: 0.08 }),
    ),
  'sfx.hit.flesh': fleshHit(0.22, 1),
  'sfx.enemy.hit': fleshHit(0.15, 0.85),
  'sfx.hit.armor': (e, out) =>
    combine(
      toneShot(e, out, { type: 'square', freq: 220, dur: 0.04, gain: 0.1 }),
      noiseShot(e, out, { dur: 0.08, gain: 0.14, filter: { type: 'bandpass', freq: 2400, q: 6 } }),
    ),
  'sfx.block': (e, out) =>
    combine(
      noiseShot(e, out, { dur: 0.12, gain: 0.18, filter: { type: 'bandpass', freq: 1200, q: 3 } }),
      toneShot(e, out, { type: 'sine', freq: 300, dur: 0.06, gain: 0.1 }),
    ),
  'sfx.parry': (e, out) =>
    combine(
      fmBell(e, out, { carrier: 1244, mod: 1244 * 1.5, idx0: 8, idx1: 0, dur: 0.4, gain: 0.2 }),
      noiseShot(e, out, { dur: 0.06, gain: 0.08, filter: { type: 'highpass', freq: 3000 } }),
    ),
  'sfx.bow.draw': (e, out) =>
    combine(
      // Rising gain 0 → 0.08 over the draw.
      noiseShot(e, out, { dur: 0.7, gain: 0.08, a: 0.65, d: 0.15, filter: { type: 'bandpass', freq: 300, q: 4 } }),
      // Creak: saw 60Hz with 9Hz amplitude modulation, g 0.03.
      ((): Shot => {
        const ac = e.context;
        if (!ac) return { dur: 0, stop: () => undefined };
        const t = e.t0();
        const osc = ac.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 60;
        const am = ac.createOscillator();
        am.type = 'sine';
        am.frequency.value = 9;
        const amDepth = ac.createGain();
        amDepth.gain.value = 0.015;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.setTargetAtTime(0.03, t, 0.2 / 3);
        am.connect(amDepth);
        amDepth.connect(g.gain);
        osc.connect(g);
        g.connect(out);
        osc.start(t);
        am.start(t);
        const stopAt = t + 0.75;
        osc.stop(stopAt);
        am.stop(stopAt);
        osc.onended = () => {
          g.disconnect();
        };
        return {
          dur: stopAt - e.now(),
          stop: () => {
            try {
              osc.stop();
              am.stop();
            } catch {
              /* noop */
            }
            g.disconnect();
          },
        };
      })(),
    ),
  'sfx.bow.release': (e, out) =>
    combine(
      noiseShot(e, out, { dur: 0.05, gain: 0.14, filter: { type: 'highpass', freq: 1500 } }),
      toneShot(e, out, { type: 'sine', freq: 400, freqEnd: 150, dur: 0.09, gain: 0.08 }),
    ),
  'sfx.arrow.hit': (e, out) =>
    combine(
      noiseShot(e, out, { dur: 0.04, gain: 0.15, filter: { type: 'bandpass', freq: 2000, q: 2 } }),
      toneShot(e, out, { type: 'sine', freq: 180, dur: 0.06, gain: 0.1 }),
    ),
  'sfx.cast.fire': (e, out) =>
    combine(
      noiseShot(e, out, { dur: 0.2, gain: 0.16, filter: { type: 'bandpass', freq: 800, q: 1 } }),
      toneShot(e, out, { type: 'sine', freq: 220, freqEnd: 90, dur: 0.25, gain: 0.12 }),
      // Burn tail: sparse crackle pops over ~1.2s (muspelheim signature), g 0.06.
      ...Array.from({ length: 5 }, (_, i) =>
        noiseShot(e, out, {
          dur: 0.004,
          a: 0.001,
          d: 0.004,
          gain: 0.06,
          at: 0.2 + i * (0.15 + Math.random() * 0.15),
          filter: { type: 'bandpass', freq: 1800 + Math.random() * 2400, q: 4 },
        }),
      ),
    ),
  'sfx.cast.ice': (e, out) =>
    combine(
      fmBell(e, out, { carrier: 1568, mod: 1568 * 2.1, idx0: 6, idx1: 0, dur: 0.3, gain: 0.14 }),
      noiseShot(e, out, { dur: 0.12, gain: 0.06, filter: { type: 'highpass', freq: 4000 } }),
    ),
  'sfx.cast.storm': (e, out) =>
    combine(
      noiseShot(e, out, { dur: 0.03, gain: 0.2, filter: { type: 'bandpass', freq: 3000, q: 2 } }),
      toneShot(e, out, { type: 'sawtooth', freq: 1200, freqEnd: 200, dur: 0.08, gain: 0.12 }),
      noiseShot(e, out, { dur: 0.2, gain: 0.1, color: 'brown', filter: { type: 'lowpass', freq: 200 } }),
    ),
  'sfx.cast.spirit': (e, out) =>
    combine(
      formantSwell(e, out, { vowel: 'u', sourceFreq: 110, attackS: 0.6, releaseS: 1.0, gain: 0.12 }),
      toneShot(e, out, { type: 'sine', freq: 660, dur: 0.6, gain: 0.05, a: 0.2 }),
    ),
  'sfx.heal': (e, out) =>
    combine(
      toneShot(e, out, { type: 'sine', freq: 523, dur: 0.6, gain: 0.08, a: 0.01 }),
      toneShot(e, out, { type: 'sine', freq: 659, dur: 0.6, gain: 0.08, a: 0.01, at: 0.08 }),
      toneShot(e, out, { type: 'sine', freq: 784, dur: 0.6, gain: 0.08, a: 0.01, at: 0.16 }),
    ),
  'sfx.enemy.die': (e, out) =>
    combine(
      toneShot(e, out, { type: 'sine', freq: 200, freqEnd: 60, dur: 0.5, gain: 0.18 }),
      noiseShot(e, out, { dur: 0.4, gain: 0.12, filter: { type: 'lowpass', freq: 600 } }),
      // Draugr rattle: 5 random bone pulses.
      ...Array.from({ length: 5 }, (_, i) =>
        noiseShot(e, out, {
          dur: 0.03,
          gain: 0.07,
          at: 0.1 + i * (0.05 + Math.random() * 0.07),
          filter: { type: 'bandpass', freq: 1400, q: 4 },
        }),
      ),
    ),
  'sfx.boss.roar': (e, out) =>
    combine(
      toneShot(e, out, {
        type: 'sawtooth',
        freq: 80,
        freqEnd: 45,
        freqT: 1.2,
        dur: 1.2,
        gain: 0.25,
        drive: 8,
        formantSweep: { from: 400, to: 700, q: 6, gain: 0.5 },
      }),
      noiseShot(e, out, { dur: 1.0, gain: 0.18, color: 'brown', filter: { type: 'lowpass', freq: 500 } }),
    ),

  // -------------------------------------------------------------- world
  'sfx.portal.hum': (e, out) =>
    // Sustained-near hum rendered as a ~1.2s swell; repeated calls blend.
    combine(
      toneShot(e, out, { type: 'sine', freq: 146.8, dur: 1.2, gain: 0.05, a: 0.3, d: 0.9 }),
      toneShot(e, out, {
        type: 'sine',
        freq: 220,
        dur: 1.2,
        gain: 0.03,
        a: 0.3,
        d: 0.9,
      }),
      noiseShot(e, out, { dur: 1.2, gain: 0.02, a: 0.3, filter: { type: 'bandpass', freq: 1200, q: 6 } }),
    ),
  'sfx.portal.travel': (e, out) =>
    combine(
      // Reverse swell: ramp 0 → 0.2 over 1.2s then hard cut.
      ((): Shot => {
        const ac = e.context;
        const buf = e.noiseBuffer('white');
        if (!ac || !buf) return { dur: 0, stop: () => undefined };
        const t = e.t0();
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2000;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.2, t + 1.2);
        g.gain.setValueAtTime(0.0001, t + 1.2);
        src.connect(lp);
        lp.connect(g);
        g.connect(out);
        src.start(t);
        src.stop(t + 1.25);
        src.onended = () => {
          g.disconnect();
        };
        return {
          dur: 1.25,
          stop: () => {
            try {
              src.stop();
            } catch {
              /* noop */
            }
            g.disconnect();
          },
        };
      })(),
      fmBell(e, out, { carrier: 880, mod: 880 * 1.5, idx0: 5, idx1: 0, dur: 0.8, gain: 0.1, at: 1.1 }),
    ),
  'sfx.harvest': (e, out) =>
    combine(
      noiseShot(e, out, { dur: 0.06, gain: 0.1, filter: { type: 'bandpass', freq: 1100, q: 2 } }),
      noiseShot(e, out, { dur: 0.06, gain: 0.1, at: 0.09, filter: { type: 'bandpass', freq: 1100, q: 2 } }),
      noiseShot(e, out, { dur: 0.06, gain: 0.1, at: 0.18, filter: { type: 'bandpass', freq: 1100, q: 2 } }),
      toneShot(e, out, { type: 'sine', freq: 330, dur: 0.08, gain: 0.06, at: 0.18 }),
    ),
  'sfx.loot': (e, out) =>
    combine(
      toneShot(e, out, { type: 'sine', freq: 660, dur: 0.06, gain: 0.08 }),
      toneShot(e, out, { type: 'sine', freq: 880, dur: 0.06, gain: 0.08, at: 0.07 }),
    ),
  'sfx.levelup': (e, out) => {
    // Pentatonic arpeggio A3–C4–D4–E4–G4–A4, sines + FM bells, 90ms apart.
    const semis = [0, 3, 5, 7, 10, 12];
    const shots: Shot[] = semis.flatMap((s, i) => {
      const freq = 220 * Math.pow(2, s / 12);
      const at = i * 0.09;
      return [
        toneShot(e, out, { type: 'sine', freq, dur: 0.7, gain: 0.12, a: 0.008, at }),
        fmBell(e, out, { carrier: freq * 2, mod: freq * 2 * 1.5, idx0: 3, idx1: 0, dur: 0.5, gain: 0.05, at }),
      ];
    });
    shots.push(formantSwell(e, out, { vowel: 'a', sourceFreq: 110, attackS: 0.4, releaseS: 0.7, gain: 0.05 }));
    return combine(...shots);
  },
  'sfx.event.horn': (e, out) =>
    // World-event horn (§5): F3 + C4 saws, 1.5s decay, through formant "a".
    combine(
      formantSwell(e, out, { vowel: 'a', sourceFreq: 174.6, attackS: 0.06, releaseS: 1.5, gain: 0.15 }),
      formantSwell(e, out, { vowel: 'a', sourceFreq: 261.6, attackS: 0.06, releaseS: 1.5, gain: 0.1 }),
    ),

  // ----------------------------------------------------------------- ui
  'sfx.ui.click': (e, out) =>
    toneShot(e, out, {
      type: 'square',
      freq: 880,
      dur: 0.025,
      gain: 0.06,
      a: 0.002,
      d: 0.025,
      filter: { type: 'lowpass', freq: 2500 },
    }),
  'sfx.ui.hover': (e, out) =>
    toneShot(e, out, { type: 'sine', freq: 1320, dur: 0.015, gain: 0.03, a: 0.002, d: 0.015 }),
  'sfx.ui.equip': (e, out) =>
    combine(
      noiseShot(e, out, { dur: 0.08, gain: 0.08, filter: { type: 'bandpass', freq: 1500, q: 2 } }),
      toneShot(e, out, { type: 'sine', freq: 220, dur: 0.06, gain: 0.06 }),
    ),
  'sfx.ui.craft': (e, out) =>
    combine(
      noiseShot(e, out, { dur: 0.1, gain: 0.1, filter: { type: 'bandpass', freq: 1800, q: 3 } }),
      noiseShot(e, out, { dur: 0.1, gain: 0.1, at: 0.14, filter: { type: 'bandpass', freq: 1800, q: 3 } }),
      toneShot(e, out, { type: 'sine', freq: 110, dur: 0.18, gain: 0.1 }),
    ),
  'sfx.ui.error': (e, out) =>
    toneShot(e, out, {
      type: 'sawtooth',
      freq: 160,
      freqEnd: 160 * 0.8,
      dur: 0.12,
      gain: 0.07,
      filter: { type: 'lowpass', freq: 600 },
    }),
  'sfx.notify.quest': (e, out) =>
    combine(
      toneShot(e, out, { type: 'sine', freq: 784, freqEnd: 1046, dur: 0.12, gain: 0.07 }),
      toneShot(e, out, { type: 'sine', freq: 1046, dur: 0.12, gain: 0.07, at: 0.12 }),
    ),
  'sfx.damage.tick': (e, out) =>
    noiseShot(e, out, { dur: 0.025, gain: 0.05, a: 0.002, d: 0.025, filter: { type: 'highpass', freq: 2500 } }),
  'sfx.reconnect.tick': (e, out) =>
    toneShot(e, out, { type: 'sine', freq: 440, dur: 0.04, gain: 0.05, a: 0.003, d: 0.04 }),
  'sfx.death': (e, out) =>
    combine(
      toneShot(e, out, { type: 'sine', freq: 220, freqEnd: 55, freqT: 1.6, dur: 1.6, gain: 0.2 }),
      formantSwell(e, out, { vowel: 'o', sourceFreq: 110, attackS: 0.4, releaseS: 2.0, gain: 0.12 }),
    ),
  'sfx.respawn': (e, out) =>
    combine(
      fmBell(e, out, { carrier: 523, mod: 523 * 1.5, idx0: 5, idx1: 0, dur: 0.8, gain: 0.12 }),
      noiseShot(e, out, { dur: 0.6, gain: 0.08, a: 0.55, d: 0.05, filter: { type: 'lowpass', freq: 2000 } }),
    ),
};

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/** Per-id minimum retrigger interval (recipe: damage tick throttled to 8/s). */
const THROTTLE_S: Record<string, number> = {
  'sfx.damage.tick': 1 / 8,
  'sfx.ui.hover': 0.05,
};
const lastPlayAt = new Map<string, number>();
const unknownLogged = new Set<string>();

export interface PlayOptions {
  position?: Vec3;
  volume?: number;
}

/**
 * Play a one-shot SFX by recipe id. Returns false when the audio context is
 * not unlocked yet or the id is unknown.
 */
export function playSfx(engine: AudioEngine, sfxId: string, opts?: PlayOptions): boolean {
  const builder = BUILDERS[sfxId];
  if (!builder) {
    if (!unknownLogged.has(sfxId)) {
      unknownLogged.add(sfxId);
      console.warn(`[audio] unknown sfxId "${sfxId}"`);
    }
    return false;
  }
  const ac = engine.context;
  const bus = engine.bus('sfx');
  if (!ac || !bus || !engine.ready) return false;

  const now = engine.now();
  const minGap = THROTTLE_S[sfxId];
  if (minGap !== undefined) {
    const last = lastPlayAt.get(sfxId) ?? -Infinity;
    if (now - last < minGap) return true;
    lastPlayAt.set(sfxId, now);
  }

  // Chain: builder → volGain → (panner | direct) → sfxBus.
  const volGain = ac.createGain();
  volGain.gain.value = opts?.volume ?? 1;
  let panner: PannerNode | null = null;
  if (opts?.position) {
    panner = engine.panner(opts.position);
  }
  if (panner) {
    volGain.connect(panner);
    panner.connect(bus);
  } else {
    volGain.connect(bus);
  }

  let shot: Shot;
  try {
    shot = builder(engine, volGain);
  } catch (err) {
    console.error(`[audio] sfx "${sfxId}" builder failed`, err);
    volGain.disconnect();
    return false;
  }

  const voice: VoiceHandle | null = engine.acquireVoice('sfx', () => {
    shot.stop();
    volGain.disconnect();
    panner?.disconnect();
  });
  if (!voice) {
    shot.stop();
    volGain.disconnect();
    panner?.disconnect();
    return false;
  }

  const releaseAfterMs = Math.max(shot.dur, 0.05) * 1000 + 300;
  window.setTimeout(() => {
    voice.release();
    // Delay node teardown slightly past the tail so nothing clicks.
    window.setTimeout(() => {
      try {
        volGain.disconnect();
        panner?.disconnect();
      } catch {
        /* noop */
      }
    }, 200);
  }, releaseAfterMs);
  return true;
}

/** All implemented recipe ids (tests / diagnostics). */
export function knownSfxIds(): string[] {
  return Object.keys(BUILDERS);
}
