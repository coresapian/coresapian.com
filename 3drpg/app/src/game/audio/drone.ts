// ============================================================================
// CORESAPIAN — src/game/audio/drone.ts (audio-net)
//
// Per-realm ambient drones (`drone.<realm>`) per audio-recipes.md §2.
// Every drone = bed (2 detuned oscillators → lowpass, slow filter LFO)
//             + air (filtered noise)
//             + signature layer(s) (some marked lowCut — skipped on quality low).
// Crossfade: 2s equal-power on realm change. Combat layer (§5): war-drum
// percussion 90BPM while boss/recent damage; realm drone ducks −6dB on boss.
// Helheim/Asgard beds include the Old-Norse vocal pad (vocal.ts).
// ============================================================================

import type { RealmId } from '../../../contracts/types';
import { REALMS } from '../../../contracts/realms';

import type { AudioEngine, NoiseColor, VoiceHandle } from './engine';
import { VocalPad } from './vocal';

const CROSSFADE_S = 2;
const XFADE_STEPS = 17;
const DRUM_BPM = 90;
const DUCK_GAIN = 0.501; // −6dB

type FilterType = BiquadFilterType;

interface Layer {
  voice: VoiceHandle | null;
  stopSources: (when: number) => void;
  disconnect: () => void;
}

interface EventLayer {
  nextAt: number;
  fire: (now: number) => void;
}

// ---------------------------------------------------------------------------
// Layer builders (each returns a Layer; sustained layers hold one amb voice)
// ---------------------------------------------------------------------------

interface BedSpec {
  type: OscillatorType;
  f1: number;
  f2: number;
  lp: number;
  q?: number;
  lfoRate: number;
  lfoDepth: number;
  gain?: number;
}

/** Bed: 2 detuned oscillators → lowpass, slow filter LFO. Gain 0.10 default. */
function buildBed(engine: AudioEngine, out: AudioNode, spec: BedSpec): Layer | null {
  const ac = engine.context;
  if (!ac) return null;
  const nodes: AudioNode[] = [];
  const oscs: OscillatorNode[] = [];
  const t = engine.t0();

  const gain = ac.createGain();
  gain.gain.value = spec.gain ?? 0.1;

  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = spec.lp;
  filter.Q.value = spec.q ?? 0.7;

  const lfo = engine.lfo(spec.lfoRate, spec.lfoDepth);
  if (lfo) {
    lfo.node.connect(filter.frequency);
    oscs.push(lfo.osc);
  }

  for (const f of [spec.f1, spec.f2]) {
    const osc = ac.createOscillator();
    osc.type = spec.type;
    osc.frequency.value = f;
    osc.connect(filter);
    osc.start(t);
    oscs.push(osc);
  }

  filter.connect(gain);
  gain.connect(out);
  nodes.push(filter, gain);

  const voice = engine.acquireVoice('amb', () => {
    for (const o of oscs) {
      try {
        o.stop();
      } catch {
        /* noop */
      }
    }
    gain.disconnect();
  });
  if (!voice) {
    for (const o of oscs) {
      try {
        o.stop();
      } catch {
        /* noop */
      }
    }
    gain.disconnect();
    return null;
  }

  return {
    voice,
    stopSources: (when) => oscs.forEach((o) => safeStop(o, when)),
    disconnect: () => {
      gain.disconnect();
      filter.disconnect();
    },
  };
}

interface NoiseLayerSpec {
  color: NoiseColor;
  filterType: FilterType;
  freq: number;
  q?: number;
  gain: number;
  gainLfoRate?: number;
  gainLfoDepth?: number;
  /** Extra post-filter chain stage (e.g. snow footsteps-style lp after bp). */
  postFilter?: { type: FilterType; freq: number; q?: number };
}

/** Air: looped filtered noise. Returns layer + the filter (for random-walk). */
function buildNoiseLayer(
  engine: AudioEngine,
  out: AudioNode,
  spec: NoiseLayerSpec,
): { layer: Layer; filter: BiquadFilterNode } | null {
  const ac = engine.context;
  const buf = engine.noiseBuffer(spec.color);
  if (!ac || !buf) return null;
  const t = engine.t0();

  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const filter = ac.createBiquadFilter();
  filter.type = spec.filterType;
  filter.frequency.value = spec.freq;
  filter.Q.value = spec.q ?? 0.7;

  let head: AudioNode = filter;
  if (spec.postFilter) {
    const post = ac.createBiquadFilter();
    post.type = spec.postFilter.type;
    post.frequency.value = spec.postFilter.freq;
    post.Q.value = spec.postFilter.q ?? 0.7;
    filter.connect(post);
    head = post;
  }

  const gain = ac.createGain();
  gain.gain.value = spec.gain;

  const oscs: OscillatorNode[] = [];
  if (spec.gainLfoRate !== undefined && spec.gainLfoDepth !== undefined) {
    const lfo = engine.lfo(spec.gainLfoRate, spec.gainLfoDepth);
    if (lfo) {
      lfo.node.connect(gain.gain);
      oscs.push(lfo.osc);
    }
  }

  src.connect(filter);
  head.connect(gain);
  gain.connect(out);
  src.start(t);

  const voice = engine.acquireVoice('amb', () => {
    safeStop(src, engine.now());
    for (const o of oscs) safeStop(o, engine.now());
    gain.disconnect();
  });
  if (!voice) {
    safeStop(src, engine.now());
    for (const o of oscs) safeStop(o, engine.now());
    gain.disconnect();
    return null;
  }

  return {
    layer: {
      voice,
      stopSources: (when) => {
        safeStop(src, when);
        oscs.forEach((o) => safeStop(o, when));
      },
      disconnect: () => gain.disconnect(),
    },
    filter,
  };
}

interface SustainedToneSpec {
  tones: Array<{ type: OscillatorType; freq: number; gain?: number; detuneCents?: number }>;
  /** Shared filter stage. */
  filter?: { type: FilterType; freq: number; q?: number };
  gain: number;
  /** Fade the whole layer in/out slowly (period seconds, midgard signature). */
  swellPeriodS?: number;
  /** Per-tone vibrato (niflheim aurora): rate Hz + depth cents. */
  vibrato?: { rate: number; depthCents: number };
  /** Output gain LFO (rate/depth, linear). */
  gainLfo?: { rate: number; depth: number };
}

function buildSustainedTones(
  engine: AudioEngine,
  out: AudioNode,
  spec: SustainedToneSpec,
): Layer | null {
  const ac = engine.context;
  if (!ac) return null;
  const t = engine.t0();
  const oscs: OscillatorNode[] = [];

  const gain = ac.createGain();
  gain.gain.value = spec.gain;

  let head: AudioNode = gain;
  if (spec.filter) {
    const f = ac.createBiquadFilter();
    f.type = spec.filter.type;
    f.frequency.value = spec.filter.freq;
    f.Q.value = spec.filter.q ?? 0.7;
    f.connect(gain);
    head = f;
  }

  if (spec.swellPeriodS && spec.swellPeriodS > 0) {
    const lfo = engine.lfo(1 / spec.swellPeriodS, spec.gain * 0.5);
    if (lfo) {
      lfo.node.connect(gain.gain);
      oscs.push(lfo.osc);
    }
  }
  if (spec.gainLfo) {
    const lfo = engine.lfo(spec.gainLfo.rate, spec.gainLfo.depth);
    if (lfo) {
      lfo.node.connect(gain.gain);
      oscs.push(lfo.osc);
    }
  }

  for (const tone of spec.tones) {
    const osc = ac.createOscillator();
    osc.type = tone.type;
    osc.frequency.value = tone.freq;
    if (tone.detuneCents) osc.detune.value = tone.detuneCents;
    if (spec.vibrato) {
      const vib = engine.lfo(spec.vibrato.rate, spec.vibrato.depthCents);
      if (vib) {
        vib.node.connect(osc.detune);
        oscs.push(vib.osc);
      }
    }
    const g = tone.gain !== undefined ? ac.createGain() : null;
    if (g) {
      g.gain.value = tone.gain ?? 1;
      osc.connect(g);
      g.connect(head);
    } else {
      osc.connect(head);
    }
    osc.start(t);
    oscs.push(osc);
  }

  gain.connect(out);

  const voice = engine.acquireVoice('amb', () => {
    oscs.forEach((o) => safeStop(o, engine.now()));
    gain.disconnect();
  });
  if (!voice) {
    oscs.forEach((o) => safeStop(o, engine.now()));
    gain.disconnect();
    return null;
  }

  return {
    voice,
    stopSources: (when) => oscs.forEach((o) => safeStop(o, when)),
    disconnect: () => gain.disconnect(),
  };
}

// ---------------------------------------------------------------------------
// Transient one-shot helpers (scheduled by EventLayers; unvoiced, sparse)
// ---------------------------------------------------------------------------

function noiseBurst(
  engine: AudioEngine,
  out: AudioNode,
  opts: {
    color: NoiseColor;
    filterType: FilterType;
    freq: number;
    q?: number;
    gain: number;
    attackS: number;
    decayS: number;
  },
): void {
  const ac = engine.context;
  const buf = engine.noiseBuffer(opts.color);
  if (!ac || !buf) return;
  const t = engine.t0();
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const filter = ac.createBiquadFilter();
  filter.type = opts.filterType;
  filter.frequency.value = opts.freq;
  filter.Q.value = opts.q ?? 1;
  const g = ac.createGain();
  engine.adsr(g.gain, t, { a: opts.attackS, d: opts.decayS, s: 0.0001, peak: opts.gain });
  src.connect(filter);
  filter.connect(g);
  g.connect(out);
  src.start(t);
  const stopAt = t + opts.attackS + opts.decayS + 0.4;
  src.stop(stopAt);
  src.onended = () => {
    g.disconnect();
  };
}

function toneGliss(
  engine: AudioEngine,
  out: AudioNode,
  opts: {
    type: OscillatorType;
    from: number;
    to: number;
    durS: number;
    gain: number;
    attackS?: number;
  },
): void {
  const ac = engine.context;
  if (!ac) return;
  const t = engine.t0();
  const osc = ac.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.from, t);
  osc.frequency.setTargetAtTime(opts.to, t, opts.durS / 3);
  const g = ac.createGain();
  const a = opts.attackS ?? opts.durS * 0.3;
  engine.adsr(g.gain, t, { a, d: opts.durS, s: 0.0001, peak: opts.gain });
  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(t + a + opts.durS + 0.4);
  osc.onended = () => {
    g.disconnect();
  };
}

function fmChirp(
  engine: AudioEngine,
  out: AudioNode,
  opts: { carrier: number; mod: number; index: number; durS: number; gain: number },
): void {
  const ac = engine.context;
  if (!ac) return;
  const t = engine.t0();
  const car = ac.createOscillator();
  car.type = 'sine';
  car.frequency.value = opts.carrier;
  const mod = ac.createOscillator();
  mod.type = 'sine';
  mod.frequency.value = opts.mod;
  const modGain = ac.createGain();
  modGain.gain.value = opts.mod * opts.index;
  mod.connect(modGain);
  modGain.connect(car.frequency);
  const g = ac.createGain();
  engine.adsr(g.gain, t, { a: 0.01, d: opts.durS, s: 0.0001, peak: opts.gain });
  car.connect(g);
  g.connect(out);
  car.start(t);
  mod.start(t);
  const stopAt = t + opts.durS + 0.3;
  car.stop(stopAt);
  mod.stop(stopAt);
  car.onended = () => {
    g.disconnect();
  };
}

// ---------------------------------------------------------------------------
// RealmDrone
// ---------------------------------------------------------------------------

class RealmDrone {
  readonly realmId: RealmId;
  private readonly engine: AudioEngine;
  private readonly out: GainNode; // crossfade gain
  private readonly duck: GainNode; // combat duck gain
  private readonly layers: Layer[] = [];
  private readonly events: EventLayer[] = [];
  private readonly pads: VocalPad[] = [];
  private disposed = false;

  constructor(engine: AudioEngine, realmId: RealmId, lowQuality: boolean) {
    this.engine = engine;
    this.realmId = realmId;
    const ac = engine.context;
    const bus = engine.bus('amb');
    if (!ac || !bus) throw new Error('[audio] drone built before AudioContext');
    this.out = ac.createGain();
    this.out.gain.value = 0.0001;
    this.duck = ac.createGain();
    this.duck.gain.value = 1;
    this.out.connect(this.duck);
    this.duck.connect(bus);
    this.build(realmId, lowQuality);
  }

  private addLayer(layer: Layer | null, lowCut: boolean, lowQuality: boolean): void {
    if (!layer) return;
    if (lowCut && lowQuality) {
      layer.stopSources(this.engine.now());
      layer.disconnect();
      layer.voice?.release();
      return;
    }
    this.layers.push(layer);
  }

  private build(realm: RealmId, lowQuality: boolean): void {
    const e = this.engine;
    const out = this.out;
    const skip = lowQuality;

    switch (realm) {
      case 'midgard': {
        this.addLayer(
          buildBed(e, out, { type: 'sawtooth', f1: 110, f2: 110.7, lp: 420, q: 0.7, lfoRate: 0.05, lfoDepth: 180 }),
          false,
          skip,
        );
        this.addLayer(
          buildNoiseLayer(e, out, { color: 'pink', filterType: 'bandpass', freq: 800, q: 0.4, gain: 0.035, gainLfoRate: 0.07, gainLfoDepth: 0.02 })?.layer ?? null,
          false,
          skip,
        );
        // A3 + just-fourth E4 fading over a 14s cycle.
        this.addLayer(
          buildSustainedTones(e, out, {
            tones: [
              { type: 'triangle', freq: 220 },
              { type: 'sine', freq: 331 },
            ],
            gain: 0.025,
            swellPeriodS: 14,
          }),
          true,
          skip,
        );
        break;
      }
      case 'alfheim': {
        this.addLayer(
          buildBed(e, out, { type: 'sine', f1: 261.6, f2: 262.3, lp: 1200, lfoRate: 0.04, lfoDepth: 400 }),
          false,
          skip,
        );
        this.addLayer(
          buildNoiseLayer(e, out, { color: 'pink', filterType: 'highpass', freq: 2000, gain: 0.02 })?.layer ?? null,
          false,
          skip,
        );
        if (!skip) {
          // FM bell choir: carrier 523, mod 523×2.4, index decay 3→0.3 / 8s.
          const ac = e.context;
          if (ac) {
            const car = ac.createOscillator();
            car.type = 'sine';
            car.frequency.value = 523;
            const mod = ac.createOscillator();
            mod.type = 'sine';
            const modFreq = 523 * 2.4;
            mod.frequency.value = modFreq;
            const modGain = ac.createGain();
            modGain.gain.value = modFreq * 3;
            mod.connect(modGain);
            modGain.connect(car.frequency);
            const g = ac.createGain();
            g.gain.value = 0.03;
            car.connect(g);
            g.connect(out);
            const t = e.t0();
            car.start(t);
            mod.start(t);
            const voice = e.acquireVoice('amb', () => {
              safeStop(car, e.now());
              safeStop(mod, e.now());
              g.disconnect();
            });
            if (voice) {
              this.layers.push({
                voice,
                stopSources: (when) => {
                  safeStop(car, when);
                  safeStop(mod, when);
                },
                disconnect: () => g.disconnect(),
              });
              // Mod-index decay cycle 3 → 0.3 every 8s.
              const cycleEv: EventLayer = {
                nextAt: e.now() + 8,
                fire: (now) => {
                  modGain.gain.cancelScheduledValues(now);
                  modGain.gain.setValueAtTime(modFreq * 3, now);
                  modGain.gain.setTargetAtTime(modFreq * 0.3, now, 8 / 3);
                  cycleEv.nextAt = now + 8;
                },
              };
              cycleEv.fire(e.now());
              this.events.push(cycleEv);
            } else {
              safeStop(car, e.now());
              safeStop(mod, e.now());
              g.disconnect();
            }
          }
          // Shimmer: 1568Hz sine, gain 0.012 with 0.11Hz ±0.015 LFO.
          this.addLayer(
            buildSustainedTones(e, out, {
              tones: [{ type: 'sine', freq: 1568 }],
              gain: 0.012,
              gainLfo: { rate: 0.11, depth: 0.015 },
            }),
            true,
            skip,
          );
        }
        break;
      }
      case 'svartalfheim': {
        this.addLayer(
          buildBed(e, out, { type: 'sawtooth', f1: 73.4, f2: 73.9, lp: 260, q: 1.2, lfoRate: 0.03, lfoDepth: 90 }),
          false,
          skip,
        );
        this.addLayer(
          buildNoiseLayer(e, out, { color: 'brown', filterType: 'lowpass', freq: 300, gain: 0.06 })?.layer ?? null,
          false,
          skip,
        );
        // D1 sub.
        this.addLayer(
          buildSustainedTones(e, out, { tones: [{ type: 'sine', freq: 36.7 }], gain: 0.05 }),
          true,
          skip,
        );
        if (!skip) {
          // Forge rhythm: filtered noise burst every 7±3s.
          const ev: EventLayer = {
            nextAt: this.engine.now() + 7 + (Math.random() * 6 - 3),
            fire: (now) => {
              noiseBurst(e, out, { color: 'white', filterType: 'bandpass', freq: 1800, q: 3, gain: 0.05, attackS: 0.005, decayS: 0.4 });
              ev.nextAt = now + 7 + (Math.random() * 6 - 3);
            },
          };
          this.events.push(ev);
        }
        break;
      }
      case 'jotunheim': {
        this.addLayer(
          buildBed(e, out, { type: 'triangle', f1: 98, f2: 98.5, lp: 500, lfoRate: 0.06, lfoDepth: 200 }),
          false,
          skip,
        );
        this.addLayer(
          buildNoiseLayer(e, out, { color: 'pink', filterType: 'bandpass', freq: 1200, q: 0.8, gain: 0.07, gainLfoRate: 0.13, gainLfoDepth: 0.04 })?.layer ?? null,
          false,
          skip,
        );
        if (!skip) {
          // Whistling crags: white noise → bp 3000 Q8, random-walk ±600Hz.
          const built = buildNoiseLayer(e, out, { color: 'white', filterType: 'bandpass', freq: 3000, q: 8, gain: 0.015 });
          this.addLayer(built?.layer ?? null, true, skip);
          if (built) {
            const filter = built.filter;
            const ev: EventLayer = {
              nextAt: this.engine.now() + 3,
              fire: (now) => {
                filter.frequency.setTargetAtTime(3000 + (Math.random() * 2 - 1) * 600, now, 1.5);
                ev.nextAt = now + 4;
              },
            };
            this.events.push(ev);
          }
        }
        break;
      }
      case 'niflheim': {
        this.addLayer(
          buildBed(e, out, { type: 'sine', f1: 87.3, f2: 87.8, lp: 350, lfoRate: 0.02, lfoDepth: 120 }),
          false,
          skip,
        );
        this.addLayer(
          buildNoiseLayer(e, out, { color: 'pink', filterType: 'lowpass', freq: 500, gain: 0.045 })?.layer ?? null,
          false,
          skip,
        );
        // Aurora pad F–A–C with shared-gain LFO + 6Hz ±4 cent vibrato.
        this.addLayer(
          buildSustainedTones(e, out, {
            tones: [
              { type: 'sine', freq: 349.2 },
              { type: 'sine', freq: 440 },
              { type: 'sine', freq: 523.2 },
            ],
            gain: 0.03,
            gainLfo: { rate: 0.03, depth: 0.02 },
            vibrato: { rate: 6, depthCents: 4 },
          }),
          true,
          skip,
        );
        break;
      }
      case 'muspelheim': {
        this.addLayer(
          buildBed(e, out, { type: 'sawtooth', f1: 82.4, f2: 83.1, lp: 300, q: 1.5, lfoRate: 0.05, lfoDepth: 100 }),
          false,
          skip,
        );
        this.addLayer(
          buildNoiseLayer(e, out, { color: 'brown', filterType: 'lowpass', freq: 240, gain: 0.08 })?.layer ?? null,
          false,
          skip,
        );
        this.addLayer(
          buildNoiseLayer(e, out, { color: 'pink', filterType: 'bandpass', freq: 2500, q: 1, gain: 0.02, gainLfoRate: 0.21, gainLfoDepth: 0.012 })?.layer ?? null,
          false,
          skip,
        );
        if (!skip) {
          // Ember crackle pops: 3ms pulses, bp 1800–4200 random, Poisson 1.2/s.
          const ev: EventLayer = {
            nextAt: this.engine.now() + Math.random(),
            fire: (now) => {
              noiseBurst(e, out, {
                color: 'white',
                filterType: 'bandpass',
                freq: 1800 + Math.random() * 2400,
                q: 4,
                gain: 0.05,
                attackS: 0.001,
                decayS: 0.003,
              });
              ev.nextAt = now + -Math.log(1 - Math.random()) / 1.2;
            },
          };
          this.events.push(ev);
        }
        break;
      }
      case 'vanaheim': {
        this.addLayer(
          buildBed(e, out, { type: 'triangle', f1: 130.8, f2: 131.4, lp: 700, lfoRate: 0.04, lfoDepth: 220 }),
          false,
          skip,
        );
        this.addLayer(
          buildNoiseLayer(e, out, { color: 'pink', filterType: 'bandpass', freq: 1000, q: 0.5, gain: 0.03 })?.layer ?? null,
          false,
          skip,
        );
        // G3 drone.
        this.addLayer(
          buildSustainedTones(e, out, { tones: [{ type: 'sine', freq: 196 }], gain: 0.02 }),
          true,
          skip,
        );
        if (!skip) {
          // Bird-galdr FM chirps, Poisson 0.4/s.
          const ev: EventLayer = {
            nextAt: this.engine.now() + 1 + Math.random() * 2,
            fire: (now) => {
              fmChirp(e, out, {
                carrier: 2200 + Math.random() * 1200,
                mod: 30 + Math.random() * 50,
                index: 5,
                durS: 0.12 + Math.random() * 0.18,
                gain: 0.035,
              });
              ev.nextAt = now + -Math.log(1 - Math.random()) / 0.4;
            },
          };
          this.events.push(ev);
        }
        break;
      }
      case 'helheim': {
        this.addLayer(
          buildBed(e, out, { type: 'sine', f1: 65.4, f2: 65.9, lp: 220, lfoRate: 0.015, lfoDepth: 60 }),
          false,
          skip,
        );
        this.addLayer(
          buildNoiseLayer(e, out, { color: 'brown', filterType: 'lowpass', freq: 180, gain: 0.05 })?.layer ?? null,
          false,
          skip,
        );
        if (!skip) {
          // Soul-wisps: sine glissandi 800→500 over 3s, every 6±4s.
          const ev: EventLayer = {
            nextAt: this.engine.now() + 3 + Math.random() * 4,
            fire: (now) => {
              toneGliss(e, out, { type: 'sine', from: 800, to: 500, durS: 3, gain: 0.02 });
              ev.nextAt = now + 6 + (Math.random() * 8 - 4);
            },
          };
          this.events.push(ev);
          // Faint formant pad, vowel "u" (§3), gain 0.015.
          const pad = new VocalPad(e, { root: 98, gain: 0.015, morph: false, vowel: 'u' });
          pad.start(2.5);
          this.pads.push(pad);
        }
        break;
      }
      case 'asgard': {
        this.addLayer(
          buildBed(e, out, { type: 'sawtooth', f1: 146.8, f2: 147.5, lp: 900, lfoRate: 0.04, lfoDepth: 300 }),
          false,
          skip,
        );
        this.addLayer(
          buildNoiseLayer(e, out, { color: 'pink', filterType: 'bandpass', freq: 1500, q: 0.6, gain: 0.03 })?.layer ?? null,
          false,
          skip,
        );
        // Brazen fifths: saw 220 + saw 329.6 → lp 1500.
        this.addLayer(
          buildSustainedTones(e, out, {
            tones: [
              { type: 'sawtooth', freq: 220 },
              { type: 'sawtooth', freq: 329.6 },
            ],
            filter: { type: 'lowpass', freq: 1500 },
            gain: 0.025,
          }),
          true,
          skip,
        );
        if (!skip) {
          // Distant thunder: brown burst lp 120, 1.5s decay, every 15±7s.
          const ev: EventLayer = {
            nextAt: this.engine.now() + 8 + Math.random() * 7,
            fire: (now) => {
              noiseBurst(e, out, { color: 'brown', filterType: 'lowpass', freq: 120, gain: 0.05, attackS: 0.02, decayS: 1.5 });
              ev.nextAt = now + 15 + (Math.random() * 14 - 7);
            },
          };
          this.events.push(ev);
          // Golden-choir vocal pad (gdd §9: pads in Asgard ambience).
          const pad = new VocalPad(e, { root: 146.8, gain: 0.03, morph: true, rRoll: false });
          pad.start(3);
          this.pads.push(pad);
        }
        break;
      }
    }
  }

  fadeIn(): void {
    const t = this.engine.now();
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueCurveAtTime(equalPowerIn(), t, CROSSFADE_S);
  }

  fadeOutDispose(): void {
    if (this.disposed) return;
    const t = this.engine.now();
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueCurveAtTime(equalPowerOut(), t, CROSSFADE_S);
    window.setTimeout(() => this.dispose(), CROSSFADE_S * 1000 + 250);
  }

  setDuck(ducked: boolean): void {
    if (this.disposed) return;
    this.duck.gain.setTargetAtTime(ducked ? DUCK_GAIN : 1, this.engine.now(), 1 / 3);
  }

  update(): void {
    if (this.disposed) return;
    const now = this.engine.now();
    for (const ev of this.events) {
      if (now >= ev.nextAt) {
        try {
          ev.fire(now);
        } catch (err) {
          console.error('[audio] drone event layer failed', err);
          ev.nextAt = now + 5;
        }
      }
    }
    for (const pad of this.pads) pad.update();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const stopAt = this.engine.now() + 0.05;
    for (const pad of this.pads) pad.stop(0.3);
    for (const layer of this.layers) {
      layer.stopSources(stopAt);
      layer.disconnect();
      layer.voice?.release();
    }
    this.layers.length = 0;
    this.events.length = 0;
    this.pads.length = 0;
    try {
      this.out.disconnect();
      this.duck.disconnect();
    } catch {
      /* noop */
    }
  }
}

// ---------------------------------------------------------------------------
// DroneManager — crossfade + combat layering (audio-recipes §5)
// ---------------------------------------------------------------------------

export class DroneManager {
  private readonly engine: AudioEngine;
  private current: RealmDrone | null = null;
  private lowQuality = false;
  private bossActive = false;
  private combatHeat = 0; // seconds remaining of "recent damage" heat
  private nextBeatAt = 0;
  private beatIndex = 0;
  private drumOut: GainNode | null = null;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  setQuality(low: boolean): void {
    this.lowQuality = low;
  }

  /** Crossfade to a new realm drone (2s equal-power). */
  crossfadeTo(realm: RealmId): void {
    if (!this.engine.ready) return;
    if (this.current?.realmId === realm) return;
    const prev = this.current;
    try {
      const next = new RealmDrone(this.engine, realm, this.lowQuality);
      next.setDuck(this.bossActive);
      next.fadeIn();
      this.current = next;
    } catch (err) {
      console.error('[audio] drone build failed', err);
      this.current = null;
    }
    prev?.fadeOutDispose();
  }

  /** Silence (dispose path). */
  stopAll(): void {
    this.current?.fadeOutDispose();
    this.current = null;
  }

  setBoss(active: boolean): void {
    if (this.bossActive === active) return;
    this.bossActive = active;
    this.current?.setDuck(active);
  }

  /** Recent damage keeps the war-drum alive for a few seconds. */
  pokeCombatHeat(seconds = 4): void {
    this.combatHeat = Math.max(this.combatHeat, seconds);
  }

  private ensureDrumOut(): GainNode | null {
    if (this.drumOut) return this.drumOut;
    const ac = this.engine.context;
    const bus = this.engine.bus('mus');
    if (!ac || !bus) return null;
    this.drumOut = ac.createGain();
    this.drumOut.gain.value = 1;
    this.drumOut.connect(bus);
    return this.drumOut;
  }

  /** Call every fixedUpdate: drone schedulers + war-drum percussion. */
  update(dt: number): void {
    this.current?.update();

    if (this.combatHeat > 0) this.combatHeat = Math.max(0, this.combatHeat - dt);
    const percussionOn = this.bossActive || this.combatHeat > 0;
    if (!percussionOn || !this.engine.ready) return;

    const out = this.ensureDrumOut();
    if (!out) return;
    // 90BPM alternating strong/weak pulses, 0.2s lookahead.
    const beatS = 60 / DRUM_BPM;
    const now = this.engine.now();
    if (this.nextBeatAt < now) this.nextBeatAt = now + 0.05;
    while (this.nextBeatAt < now + 0.2) {
      const strong = this.beatIndex % 2 === 0;
      this.scheduleDrum(this.nextBeatAt, strong ? 0.1 : 0.05);
      this.nextBeatAt += beatS;
      this.beatIndex += 1;
    }
  }

  private scheduleDrum(at: number, gain: number): void {
    const ac = this.engine.context;
    const buf = this.engine.noiseBuffer('brown');
    const out = this.drumOut;
    if (!ac || !buf || !out) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.setTargetAtTime(gain, at, 0.004);
    g.gain.setTargetAtTime(0.0001, at + 0.01, 0.045);
    src.connect(filter);
    filter.connect(g);
    g.connect(out);
    src.start(at);
    src.stop(at + 0.35);
    src.onended = () => {
      g.disconnect();
    };
  }

  dispose(): void {
    this.current?.dispose();
    this.current = null;
    if (this.drumOut) {
      try {
        this.drumOut.disconnect();
      } catch {
        /* noop */
      }
      this.drumOut = null;
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function safeStop(src: OscillatorNode | AudioBufferSourceNode, when: number): void {
  try {
    src.stop(when);
  } catch {
    /* already stopped */
  }
}

let curveIn: Float32Array | null = null;
let curveOut: Float32Array | null = null;

function equalPowerIn(): Float32Array {
  if (!curveIn) {
    curveIn = new Float32Array(XFADE_STEPS);
    for (let i = 0; i < XFADE_STEPS; i++) {
      curveIn[i] = Math.sin((i / (XFADE_STEPS - 1)) * (Math.PI / 2));
    }
    curveIn[XFADE_STEPS - 1] = 1;
  }
  return curveIn;
}

function equalPowerOut(): Float32Array {
  if (!curveOut) {
    curveOut = new Float32Array(XFADE_STEPS);
    for (let i = 0; i < XFADE_STEPS; i++) {
      curveOut[i] = Math.cos((i / (XFADE_STEPS - 1)) * (Math.PI / 2));
    }
    curveOut[XFADE_STEPS - 1] = 0.0001;
  }
  return curveOut;
}

/** Resolve a realm id to its recipe id (`drone.<realm>`, realms.ts). */
export function droneIdForRealm(realm: RealmId): string {
  return REALMS[realm].ambientAudioId;
}
