// ============================================================================
// CORESAPIAN — src/game/audio/vocal.ts (audio-net)
//
// `pad.voices` — the Old-Norse vocal pad (audio-recipes.md §3). Three detuned
// sawtooths → parallel bandpass formant bank (F1/F2/F3, Q 10) with slow vowel
// morphing (a → o → u), formant gains 1.0 / 0.6 / 0.35 → lowpass 3kHz → slow
// chorus (18ms & 27ms delays, 0.2Hz LFO) — plus a sub-bass fifth (R/2, R×0.75)
// and a 0.07Hz "breathing choir" amplitude LFO. Optional 24Hz r-roll AM.
//
// Used in boss fights (R=110), portal channels (R=146.8), and Helheim (R=98) /
// Asgard (R=146.8) ambience layers.
// ============================================================================

import type { AudioEngine, VoiceHandle } from './engine';

export type Vowel = 'a' | 'o' | 'u';

/** Formant frequencies per vowel (audio-recipes §3). */
const FORMANTS: Record<Vowel, readonly [number, number, number]> = {
  a: [730, 1090, 2440],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
};
const FORMANT_GAINS = [1.0, 0.6, 0.35] as const;
const VOWEL_CYCLE: readonly Vowel[] = ['a', 'o', 'u'];
const MORPH_PERIOD_S = 8;
const MORPH_RAMP_S = 2;

export interface VocalPadOptions {
  /** Root frequency R (boss 110, portal 146.8, helheim 98). */
  root: number;
  /** Output gain scalar (recipe default 0.05). */
  gain?: number;
  /** Slow a→o→u morph every 8s (disable for static beds like Helheim 'u'). */
  morph?: boolean;
  /** Optional consonant r-roll: AM 24Hz depth 0.5 for 0.8s every 11±5s. */
  rRoll?: boolean;
  /** Starting (or fixed, when morph=false) vowel. */
  vowel?: Vowel;
}

export class VocalPad {
  private readonly engine: AudioEngine;
  private readonly opts: Required<VocalPadOptions>;

  private out: GainNode | null = null;
  private padGain: GainNode | null = null;
  private rollGain: GainNode | null = null;
  private formantFilters: BiquadFilterNode[] = [];
  private sources: OscillatorNode[] = [];
  private lfos: OscillatorNode[] = [];
  private voice: VoiceHandle | null = null;

  private running = false;
  private vowelIndex = 0;
  private nextMorphAt = 0;
  private nextRollAt = 0;

  constructor(engine: AudioEngine, opts: VocalPadOptions) {
    this.engine = engine;
    this.opts = {
      root: opts.root,
      gain: opts.gain ?? 0.05,
      morph: opts.morph ?? true,
      rRoll: opts.rRoll ?? false,
      vowel: opts.vowel ?? 'a',
    };
    this.vowelIndex = Math.max(0, VOWEL_CYCLE.indexOf(this.opts.vowel));
  }

  get active(): boolean {
    return this.running;
  }

  /** Start the pad with a slow swell (ambience never hard-cuts). */
  start(fadeS = 1.5): void {
    if (this.running) return;
    const ac = this.engine.context;
    const bus = this.engine.bus('mus');
    if (!ac || !bus) return;

    const voice = this.engine.acquireVoice('amb', () => this.teardown(fadeS));
    if (!voice) return; // ambience budget exhausted — skip the layer
    this.voice = voice;

    const t = this.engine.t0();
    const R = this.opts.root;

    // Output + swell.
    this.out = ac.createGain();
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.setTargetAtTime(1, t, fadeS / 3);
    this.out.connect(bus);

    // Breathing-choir amplitude LFO (0.07Hz ±0.012) on the pad gain.
    this.padGain = ac.createGain();
    this.padGain.gain.value = this.opts.gain;
    const breathe = this.engine.lfo(0.07, 0.012);
    if (breathe) {
      breathe.node.connect(this.padGain.gain);
      this.lfos.push(breathe.osc);
    }

    // r-roll AM gain (1 = open; dipped to 0.5 at 24Hz during a roll).
    this.rollGain = ac.createGain();
    this.rollGain.gain.value = 1;

    // Chorus: dry + two modulated short delays (18ms / 27ms, depth 4ms).
    const mix = ac.createGain();
    const dry = ac.createGain();
    dry.gain.value = 1;
    mix.connect(dry);
    dry.connect(this.padGain);
    const delays: Array<{ base: number; phase: number }> = [
      { base: 0.018, phase: 0 },
      { base: 0.027, phase: 1.3 },
    ];
    for (const d of delays) {
      const delay = ac.createDelay(0.06);
      delay.delayTime.value = d.base;
      const lfo = ac.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.2;
      const lfoDepth = ac.createGain();
      lfoDepth.gain.value = 0.004;
      lfo.connect(lfoDepth);
      lfoDepth.connect(delay.delayTime);
      lfo.start(t);
      this.lfos.push(lfo);
      const wet = ac.createGain();
      wet.gain.value = 0.4;
      mix.connect(delay);
      delay.connect(wet);
      wet.connect(this.padGain);
    }

    this.padGain.connect(this.rollGain);
    this.rollGain.connect(this.out);

    // Formant bank: 3 parallel bandpass (Q 10), gains 1.0 / 0.6 / 0.35,
    // summed → lowpass 3kHz → chorus.
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    lp.connect(mix);

    const formantSum = ac.createGain();
    formantSum.connect(lp);

    const vowel = FORMANTS[this.opts.vowel];
    const sourceSum = ac.createGain();
    sourceSum.gain.value = 0.33;

    this.formantFilters = vowel.map((freq, i) => {
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 10;
      const g = ac.createGain();
      g.gain.value = FORMANT_GAINS[i] ?? 1;
      sourceSum.connect(bp);
      bp.connect(g);
      g.connect(formantSum);
      return bp;
    });

    // Source: 3 detuned saws at R (−8/0/+8 cents).
    for (const cents of [-8, 0, 8]) {
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = R;
      osc.detune.value = cents;
      osc.connect(sourceSum);
      osc.start(t);
      this.sources.push(osc);
    }

    // Sub-bass fifth: sine R/2 + sine R×0.75, gain 0.03.
    const subGain = ac.createGain();
    subGain.gain.value = 0.03;
    subGain.connect(this.out);
    for (const mult of [0.5, 0.75]) {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = R * mult;
      osc.connect(subGain);
      osc.start(t);
      this.sources.push(osc);
    }

    this.running = true;
    this.nextMorphAt = this.engine.now() + MORPH_PERIOD_S;
    this.nextRollAt = this.engine.now() + 6 + Math.random() * 10;
  }

  /** Per-tick scheduler: vowel morph + r-roll. Call from the audio stage. */
  update(): void {
    if (!this.running) return;
    const now = this.engine.now();

    if (this.opts.morph && now >= this.nextMorphAt) {
      this.nextMorphAt = now + MORPH_PERIOD_S;
      this.vowelIndex = (this.vowelIndex + 1) % VOWEL_CYCLE.length;
      const target = FORMANTS[VOWEL_CYCLE[this.vowelIndex] ?? 'a'];
      this.formantFilters.forEach((bp, i) => {
        const f = target[i] ?? bp.frequency.value;
        bp.frequency.setTargetAtTime(f, now, MORPH_RAMP_S / 3);
      });
    }

    if (this.opts.rRoll && this.rollGain && now >= this.nextRollAt) {
      this.nextRollAt = now + 11 + (Math.random() * 10 - 5);
      const ac = this.engine.context;
      if (ac) {
        // 24Hz AM, depth 0.5, for 0.8s.
        const am = ac.createOscillator();
        am.type = 'sine';
        am.frequency.value = 24;
        const depth = ac.createGain();
        depth.gain.value = 0.25;
        const t = now + 0.01;
        const g = this.rollGain.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(0.5, t);
        am.connect(depth);
        depth.connect(g);
        am.start(t);
        am.stop(t + 0.8);
        g.setValueAtTime(0.5, t + 0.8);
        g.setTargetAtTime(1, t + 0.8, 0.05);
      }
    }
  }

  /** Stop with a gentle fade (≥200ms ramps — ambience never hard-cuts). */
  stop(fadeS = 0.8): void {
    if (!this.running) return;
    this.running = false;
    this.teardown(fadeS);
    this.voice?.release(); // free the ambience slot; teardown owns the tail
    this.voice = null;
  }

  private teardown(fadeS: number): void {
    const ac = this.engine.context;
    const t = this.engine.now();
    if (ac && this.out) {
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setTargetAtTime(0.0001, t, Math.max(fadeS, 0.2) / 3);
    }
    const stopAt = t + Math.max(fadeS, 0.25) + 0.3;
    for (const osc of this.sources) {
      try {
        osc.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
    for (const lfo of this.lfos) {
      try {
        lfo.stop(stopAt);
      } catch {
        /* noop */
      }
    }
    const out = this.out;
    window.setTimeout(() => {
      try {
        out?.disconnect();
      } catch {
        /* noop */
      }
    }, (stopAt - t) * 1000 + 100);
    this.sources = [];
    this.lfos = [];
    this.formantFilters = [];
    this.out = null;
    this.padGain = null;
    this.rollGain = null;
  }
}
