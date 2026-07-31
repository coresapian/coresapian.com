// ============================================================================
// CORESAPIAN — src/game/audio/engine.ts (audio-net)
//
// Fully procedural WebAudio engine (zero samples). One lazily-created
// AudioContext (first user gesture), master chain per audio-recipes.md §1:
//
//   sfxBus ──┐
//   ambBus ──┼→ masterFilter → masterGain → compressor(−18dB, 4:1) → out
//   musBus ──┘
//
// Bus gains follow the Settings slice (volumeMaster / volumeMusic / volumeSfx);
// ambience + music both ride volumeMusic. Voice budget: ≤64 total, ambience
// ≤8 (halved to 4 on quality 'low'); SFX steals oldest when full.
// ============================================================================

/** Minimal structural camera surface (keeps the audio package three-free). */
export interface CameraLike {
  position: { x: number; y: number; z: number };
  matrixWorld: { elements: ArrayLike<number> };
  updateMatrixWorld?: () => void;
}

export type NoiseColor = 'white' | 'pink' | 'brown';
export type VoiceKind = 'sfx' | 'amb' | 'mus';

export interface VoiceHandle {
  readonly kind: VoiceKind;
  /** Release the voice slot without stopping audio (one-shot finished). */
  release(): void;
  /** Force-stop the voice (used by oldest-steal). */
  stop(): void;
}

interface VoiceEntry {
  kind: VoiceKind;
  born: number;
  stopFn: () => void;
  released: boolean;
}

const MAX_VOICES = 64;
const AMBIENCE_VOICES_HIGH = 8;
const AMBIENCE_VOICES_LOW = 4;
const SCHEDULE_AHEAD_S = 0.01;

export interface AdsrSpec {
  a: number; // attack seconds
  d: number; // decay seconds
  s: number; // sustain level 0..1 (fraction of peak)
  peak: number;
}

export class AudioEngine {
  private ac: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterFilter: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private musBus: GainNode | null = null;

  private readonly voices = new Set<VoiceEntry>();
  private readonly noiseCache = new Map<NoiseColor, AudioBuffer>();
  private gestureBound = false;
  private gestureTarget: Window | null = null;
  private readonly gestureUnlock = (): void => {
    this.ensure();
  };
  private disposed = false;
  private quality: 'low' | 'medium' | 'high' = 'high';

  // ------------------------------------------------------------ lifecycle

  /** True once the AudioContext exists and is running. */
  get ready(): boolean {
    return this.ac !== null && this.ac.state === 'running';
  }

  /** Raw context, or null before the first user gesture. */
  get context(): AudioContext | null {
    return this.ac;
  }

  /** Audio clock (seconds). 0 before boot. */
  now(): number {
    return this.ac ? this.ac.currentTime : 0;
  }

  /** All one-shots are scheduled at now + 10ms (audio-recipes §1). */
  t0(): number {
    return this.now() + SCHEDULE_AHEAD_S;
  }

  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.quality = q;
  }

  get ambienceVoiceCap(): number {
    return this.quality === 'low' ? AMBIENCE_VOICES_LOW : AMBIENCE_VOICES_HIGH;
  }

  /**
   * Create/resume the AudioContext. Must be called from (or after) a user
   * gesture; call sites: pointerdown/keydown listeners, pointer_lock event.
   */
  ensure(): AudioContext | null {
    if (this.disposed) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ac) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.ac = new Ctor();
      } catch {
        return null;
      }
      this.buildChain();
    }
    if (this.ac.state === 'suspended') {
      void this.ac.resume().catch(() => undefined);
    }
    return this.ac;
  }

  /** Bind the one-time gesture listeners that unlock audio. Idempotent. */
  bindGestureUnlock(target: Window): void {
    if (this.gestureBound) return;
    this.gestureBound = true;
    this.gestureTarget = target;
    target.addEventListener('pointerdown', this.gestureUnlock, { passive: true });
    target.addEventListener('keydown', this.gestureUnlock);
  }

  private buildChain(): void {
    const ac = this.ac;
    if (!ac) return;

    this.compressor = ac.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.ratio.value = 4;
    this.compressor.connect(ac.destination);

    this.masterGain = ac.createGain();
    // Low-HP effect filter (audio-recipes §5): effectively bypassed at 19.5kHz.
    this.masterFilter = ac.createBiquadFilter();
    this.masterFilter.type = 'lowpass';
    this.masterFilter.frequency.value = 19500;
    this.masterFilter.Q.value = 0.5;
    this.masterGain.connect(this.masterFilter);
    this.masterFilter.connect(this.compressor);

    this.sfxBus = ac.createGain();
    this.ambBus = ac.createGain();
    this.musBus = ac.createGain();
    this.sfxBus.connect(this.masterGain);
    this.ambBus.connect(this.masterGain);
    this.musBus.connect(this.masterGain);
  }

  /** Settings slice → bus gains (smooth ramp to avoid zipper noise). */
  applyVolumes(master: number, music: number, sfx: number): void {
    const ac = this.ac;
    if (!ac) return;
    const t = ac.currentTime;
    const tau = 0.05;
    this.masterGain?.gain.setTargetAtTime(clamp01(master), t, tau);
    this.musBus?.gain.setTargetAtTime(clamp01(music), t, tau);
    this.ambBus?.gain.setTargetAtTime(clamp01(music), t, tau);
    this.sfxBus?.gain.setTargetAtTime(clamp01(sfx), t, tau);
  }

  /** Low-HP master lowpass (audio-recipes §5). freq 800 = engaged, 19500 = off. */
  setMasterLowpass(freqHz: number, rampS = 0.5): void {
    const ac = this.ac;
    if (!ac || !this.masterFilter) return;
    this.masterFilter.frequency.setTargetAtTime(freqHz, ac.currentTime, rampS / 3);
  }

  bus(kind: VoiceKind): GainNode | null {
    if (kind === 'sfx') return this.sfxBus;
    if (kind === 'amb') return this.ambBus;
    return this.musBus;
  }

  // ------------------------------------------------------------- voices

  /**
   * Acquire a voice slot. SFX voices steal the oldest SFX voice when the 64
   * voice budget is exhausted. Ambience returns null when its cap is reached
   * (the layer is skipped — never hard-cut).
   */
  acquireVoice(kind: VoiceKind, stopFn: () => void): VoiceHandle | null {
    if (!this.ac) return null;

    if (kind === 'amb') {
      let ambCount = 0;
      for (const v of this.voices) if (v.kind === 'amb' && !v.released) ambCount += 1;
      if (ambCount >= this.ambienceVoiceCap) return null;
    }

    if (this.voices.size >= MAX_VOICES) {
      // Steal oldest SFX voice (combat SFX take priority over ambience).
      let oldest: VoiceEntry | null = null;
      for (const v of this.voices) {
        if (v.kind !== 'sfx') continue;
        if (!oldest || v.born < oldest.born) oldest = v;
      }
      if (oldest) {
        try {
          oldest.stopFn();
        } catch {
          /* already stopped */
        }
        this.voices.delete(oldest);
      } else if (kind === 'amb') {
        return null; // budget full of sustained voices; ambience yields
      }
    }

    const entry: VoiceEntry = { kind, born: this.ac.currentTime, stopFn, released: false };
    this.voices.add(entry);
    return {
      kind,
      release: () => {
        entry.released = true;
        this.voices.delete(entry);
      },
      stop: () => {
        if (entry.released) return;
        entry.released = true;
        this.voices.delete(entry);
        try {
          stopFn();
        } catch {
          /* noop */
        }
      },
    };
  }

  activeVoiceCount(): number {
    return this.voices.size;
  }

  // ------------------------------------------------------------- helpers

  /** Shared noise buffer (2s, cached per color) per audio-recipes §1. */
  noiseBuffer(color: NoiseColor): AudioBuffer | null {
    const ac = this.ac;
    if (!ac) return null;
    const cached = this.noiseCache.get(color);
    if (cached) return cached;
    const seconds = 2;
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    if (color === 'white') {
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } else if (color === 'pink') {
      // −3dB/oct one-pole cascade (Paul Kellet approximation).
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.25;
      }
    } else {
      // brown: −6dB/oct integrator with dc-block leak.
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
    }
    this.noiseCache.set(color, buf);
    return buf;
  }

  /** ADSR via setTargetAtTime (τ = stage/3) per audio-recipes §1. */
  adsr(param: AudioParam, t0: number, spec: AdsrSpec): void {
    param.setValueAtTime(0.0001, t0);
    param.setTargetAtTime(Math.max(spec.peak, 0.0001), t0, Math.max(spec.a, 0.001) / 3);
    param.setTargetAtTime(
      Math.max(spec.peak * spec.s, 0.0001),
      t0 + spec.a,
      Math.max(spec.d, 0.001) / 3,
    );
  }

  /** Schedule the release stage of an envelope. */
  release(param: AudioParam, tEnd: number, r: number): void {
    param.setTargetAtTime(0.0001, tEnd, Math.max(r, 0.001) / 3);
  }

  /** LFO → GainNode; connect the returned node to any AudioParam. */
  lfo(rateHz: number, depth: number): { node: GainNode; osc: OscillatorNode } | null {
    const ac = this.ac;
    if (!ac) return null;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = rateHz;
    const gain = ac.createGain();
    gain.gain.value = depth;
    osc.connect(gain);
    osc.start();
    return { node: gain, osc };
  }

  /** HRTF positional panner per audio-recipes §1 (ref 4m, max 60m, inverse). */
  panner(pos: { x: number; y: number; z: number }): PannerNode | null {
    const ac = this.ac;
    if (!ac) return null;
    const p = ac.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 4;
    p.maxDistance = 60;
    p.rolloffFactor = 1;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else {
      p.setPosition(pos.x, pos.y, pos.z);
    }
    return p;
  }

  /** Waveshaper drive curve (amount ≈ recipe "drive N"). */
  driveCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount);
    }
    return curve;
  }

  /** Listener follows the camera every frame (position + forward/up). */
  syncListener(cam: CameraLike): void {
    const ac = this.ac;
    if (!ac || ac.state !== 'running') return;
    cam.updateMatrixWorld?.();
    const e = cam.matrixWorld.elements;
    // Camera looks down local −Z: forward = negated third basis column.
    const fx = -e[8];
    const fy = -e[9];
    const fz = -e[10];
    const ux = e[4];
    const uy = e[5];
    const uz = e[6];
    const l = ac.listener;
    const x = cam.position.x;
    const y = cam.position.y;
    const z = cam.position.z;
    if (l.positionX) {
      const t = ac.currentTime;
      const tau = 0.02;
      l.positionX.setTargetAtTime(x, t, tau);
      l.positionY.setTargetAtTime(y, t, tau);
      l.positionZ.setTargetAtTime(z, t, tau);
      l.forwardX.setTargetAtTime(fx, t, tau);
      l.forwardY.setTargetAtTime(fy, t, tau);
      l.forwardZ.setTargetAtTime(fz, t, tau);
      l.upX.setTargetAtTime(ux, t, tau);
      l.upY.setTargetAtTime(uy, t, tau);
      l.upZ.setTargetAtTime(uz, t, tau);
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // ------------------------------------------------------------- teardown

  dispose(): void {
    this.disposed = true;
    if (this.gestureTarget) {
      this.gestureTarget.removeEventListener('pointerdown', this.gestureUnlock);
      this.gestureTarget.removeEventListener('keydown', this.gestureUnlock);
      this.gestureTarget = null;
    }
    for (const v of [...this.voices]) {
      try {
        v.stopFn();
      } catch {
        /* noop */
      }
    }
    this.voices.clear();
    this.noiseCache.clear();
    if (this.ac) {
      void this.ac.close().catch(() => undefined);
    }
    this.ac = null;
    this.masterGain = null;
    this.masterFilter = null;
    this.compressor = null;
    this.sfxBus = null;
    this.ambBus = null;
    this.musBus = null;
    this.gestureBound = false;
  }
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Deterministic-free jitter helper for pitch/duration variation. */
export function vary(amount: number): number {
  return 1 + (Math.random() * 2 - 1) * amount;
}
