// ============================================================================
// CORESAPIAN — FPS counter (settings.showFps), top-left mono micro.
// ============================================================================

import { useEffect, useState } from 'react';

import { useSettings } from '@/game/store';

export default function FpsCounter() {
  const showFps = useSettings().showFps;
  const [fps, setFps] = useState(0);

  useEffect(() => {
    if (!showFps) return;
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      frames += 1;
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showFps]);

  if (!showFps) return null;
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10">
      <span className="stat micro bg-abyss/70 px-2 py-0.5 text-bone-dim">{fps} FPS</span>
    </div>
  );
}
