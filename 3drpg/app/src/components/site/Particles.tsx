// ============================================================================
// CORESAPIAN — src/components/site/Particles.tsx
// Single-canvas ambient particle field (design.md §5.2 "motes" / realms.md
// chapter underlays). ≤40 particles, transform-free 2d canvas, runs only
// while the host section is in the viewport; off for reduced motion.
// ============================================================================

import { memo, useEffect, useRef } from 'react';

export type ParticleMode =
  | 'fog'      // Midgard — slow horizontal wisps, 3 drift speeds
  | 'snow'     // Jötunheim — fall + lateral gusts every 6–9s
  | 'glitter'  // Niflheim — near-static ice glitter, stepped twinkle
  | 'embers'   // Muspelheim — rise with fast flicker
  | 'motes'    // Alfheim — light motes float up, 2s twinkle
  | 'sparks'   // Svartalfheim — violet sparks drift down (embers reversed)
  | 'pollen'   // Vanaheim — golden pollen on slow lateral shafts
  | 'gold'     // Asgard — fine gold dust settling
  | 'wisps';   // Helheim — soul wisps rise, fade by 60% height

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  baseA: number;
  phase: number;
  speed: number;
  tw: number; // twinkle target for glitter
}

const MAX_PARTICLES = 36;

function spawn(mode: ParticleMode, w: number, h: number, i: number): Particle {
  const p: Particle = {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: 0,
    vy: 0,
    r: 1 + Math.random() * 1.6,
    a: 0,
    baseA: 0.35 + Math.random() * 0.45,
    phase: Math.random() * Math.PI * 2,
    speed: 0.5 + Math.random(),
    tw: 1,
  };
  switch (mode) {
    case 'fog':
      p.r = 26 + Math.random() * 42;
      p.baseA = 0.028 + Math.random() * 0.035;
      // 3 drift speeds (40/60/90s loops feel)
      p.speed = [0.5, 0.33, 0.22][i % 3]!;
      p.vx = (8 + Math.random() * 10) * p.speed;
      p.vy = (Math.random() - 0.5) * 1.2;
      break;
    case 'snow':
      p.vy = 14 + Math.random() * 20;
      p.r = 0.9 + Math.random() * 1.5;
      p.baseA = 0.4 + Math.random() * 0.4;
      break;
    case 'glitter':
      p.r = 0.7 + Math.random() * 1.3;
      p.baseA = 0.25 + Math.random() * 0.55;
      p.tw = Math.random() > 0.5 ? 1 : 0.15;
      break;
    case 'embers':
      p.vy = -(12 + Math.random() * 22);
      p.r = 0.8 + Math.random() * 1.4;
      p.baseA = 0.5 + Math.random() * 0.4;
      break;
    case 'motes':
      p.vy = -(4 + Math.random() * 8);
      p.r = 1 + Math.random() * 1.8;
      p.baseA = 0.35 + Math.random() * 0.4;
      break;
    case 'sparks':
      p.vy = 8 + Math.random() * 14;
      p.r = 0.8 + Math.random() * 1.4;
      p.baseA = 0.4 + Math.random() * 0.45;
      break;
    case 'pollen':
      p.vy = 3 + Math.random() * 6;
      p.r = 1 + Math.random() * 1.6;
      p.baseA = 0.3 + Math.random() * 0.4;
      break;
    case 'gold':
      p.vy = 2 + Math.random() * 5;
      p.r = 0.6 + Math.random() * 1.1;
      p.baseA = 0.35 + Math.random() * 0.45;
      break;
    case 'wisps':
      p.vy = -(6 + Math.random() * 10);
      p.r = 1.4 + Math.random() * 2.2;
      p.baseA = 0.4 + Math.random() * 0.45;
      break;
  }
  return p;
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(255,255,255,${alpha})`;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export const ParticleField = memo(function ParticleField({
  mode,
  color,
  className = '',
  count = MAX_PARTICLES,
}: {
  mode: ParticleMode;
  /** Hex accent, e.g. '#6FA287'. */
  color: string;
  className?: string;
  count?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let particles: Particle[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    let running = false;
    let last = 0;
    let gustUntil = 0;
    let nextGust = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (particles.length === 0) {
        const n = Math.min(count, MAX_PARTICLES);
        particles = Array.from({ length: n }, (_, i) => spawn(mode, w, h, i));
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const step = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(step);
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      const t = now / 1000;
      ctx.clearRect(0, 0, w, h);

      // Jötunheim gust envelope: ramp for ~300ms every 6–9s.
      let gust = 0;
      if (mode === 'snow') {
        if (now > nextGust) {
          gustUntil = now + 1400;
          nextGust = now + 6000 + Math.random() * 3000;
        }
        if (now < gustUntil) {
          const k = 1 - (gustUntil - now) / 1400;
          gust = Math.sin(Math.min(1, k * 4) * Math.PI * 0.5) * 26;
        }
      }

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]!;
        switch (mode) {
          case 'fog':
            p.x += p.vx * dt;
            p.y += p.vy * dt + Math.sin(t * 0.1 + p.phase) * 0.06;
            p.a = p.baseA;
            if (p.x - p.r > w) p.x = -p.r;
            break;
          case 'snow':
            p.y += p.vy * dt;
            p.x += (Math.sin(t * 0.6 + p.phase) * 8 + gust) * dt;
            p.a = p.baseA;
            if (p.y > h + 4) {
              p.y = -4;
              p.x = Math.random() * w;
            }
            break;
          case 'glitter': {
            // stepped twinkle 1–3s
            const step = Math.floor(t / (1 + (i % 3)) + p.phase);
            p.tw = (step * 2654435761 + i * 97) % 100 / 100 > 0.55 ? 1 : 0.12;
            p.a += (p.baseA * p.tw - p.a) * Math.min(1, dt * 10);
            break;
          }
          case 'embers':
            p.y += p.vy * dt;
            p.x += Math.sin(t * 1.2 + p.phase) * 9 * dt;
            p.a = p.baseA * (0.55 + 0.45 * Math.sin(t * 15 + p.phase * 7)); // 0.4s flicker
            if (p.y < -4) {
              p.y = h + 4;
              p.x = Math.random() * w;
            }
            break;
          case 'motes':
            p.y += p.vy * dt;
            p.x += Math.sin(t * 0.5 + p.phase) * 6 * dt;
            p.a = p.baseA * (0.5 + 0.5 * Math.sin(t * Math.PI + p.phase)); // 2s twinkle
            if (p.y < -4) {
              p.y = h + 4;
              p.x = Math.random() * w;
            }
            break;
          case 'sparks':
            p.y += p.vy * dt;
            p.x += Math.sin(t * 0.9 + p.phase) * 7 * dt;
            p.a = p.baseA * (0.6 + 0.4 * Math.sin(t * 9 + p.phase * 5));
            if (p.y > h + 4) {
              p.y = -4;
              p.x = Math.random() * w;
            }
            break;
          case 'pollen':
            p.y += p.vy * dt;
            p.x += Math.sin(t * 0.35 + p.phase) * 12 * dt;
            p.a = p.baseA * (0.6 + 0.4 * Math.sin(t * 1.4 + p.phase));
            if (p.y > h + 4) {
              p.y = -4;
              p.x = Math.random() * w;
            }
            break;
          case 'gold':
            p.y += p.vy * dt;
            p.x += Math.sin(t * 0.4 + p.phase) * 5 * dt;
            p.a = p.baseA * (0.5 + 0.5 * Math.sin(t * 2.2 + p.phase * 3));
            if (p.y > h + 3) {
              p.y = -3;
              p.x = Math.random() * w;
            }
            break;
          case 'wisps': {
            p.y += p.vy * dt;
            p.x += Math.sin(t * 0.55 + p.phase) * 8 * dt;
            const fade = Math.max(0, 1 - (1 - p.y / h) / 0.6); // fade by 60% height
            p.a = p.baseA * fade * (0.7 + 0.3 * Math.sin(t * 3 + p.phase));
            if (p.y < h * 0.32 || p.a <= 0.005) {
              p.y = h * (0.9 + Math.random() * 0.1);
              p.x = Math.random() * w;
            }
            break;
          }
        }

        if (mode === 'fog') {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          g.addColorStop(0, hexToRgba(color, p.a));
          g.addColorStop(1, hexToRgba(color, 0));
          ctx.fillStyle = g;
          ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = hexToRgba(color, Math.max(0, Math.min(1, p.a)));
          ctx.fill();
        }
      }
    };

    // Start/stop with viewport visibility (perf guardrail §5.3).
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (visible && !running) {
          running = true;
          last = performance.now();
          raf = requestAnimationFrame(step);
        } else if (!visible && running) {
          running = false;
          cancelAnimationFrame(raf);
        }
      },
      { rootMargin: '80px' },
    );
    io.observe(canvas);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
    };
  }, [mode, color, count]);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      aria-hidden="true"
    />
  );
});
