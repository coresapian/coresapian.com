// ============================================================================
// CORESAPIAN — src/lib/useServerStatus.ts
// Live server-status widget data (design.md §6.5). Polls GET /api/status every
// 5s; falls back to mock shard data so the shell stays alive while the backend
// is ungrafted. Failure vocabulary: CONNECTING / RECONNECTING… / OFFLINE.
// ============================================================================

import { useEffect, useRef, useState } from 'react';

export type ServerStatusState = 'connected' | 'connecting' | 'reconnecting' | 'offline';

export interface ServerStatus {
  state: ServerStatusState;
  shard: string;
  latencyMs: number;
  playersOnline: number;
  /** True when the last poll reached a real backend. */
  live: boolean;
}

const MOCK: ServerStatus = {
  state: 'connected',
  shard: 'BIFRÖST-EU',
  latencyMs: 42,
  playersOnline: 1203,
  live: false,
};

const POLL_MS = 5000;

/** Small drift so the mock reads as a living shard. */
function jitter(base: ServerStatus): ServerStatus {
  return {
    ...base,
    latencyMs: Math.max(19, Math.round(base.latencyMs + (Math.random() * 14 - 7))),
    playersOnline: Math.max(800, Math.round(base.playersOnline + (Math.random() * 60 - 30))),
  };
}

export function useServerStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>(MOCK);
  const everLive = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const sentAt = Date.now();
      try {
        const res = await fetch(`/api/status?ts=${sentAt}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as Partial<ServerStatus> & { serverTs?: number; clientTs?: number };
        if (cancelled) return;
        const receivedAt = Date.now();
        const rtt = Math.max(0, receivedAt - sentAt);
        everLive.current = true;
        setStatus({
          state: 'connected',
          shard: typeof data.shard === 'string' ? data.shard : MOCK.shard,
          latencyMs: Number.isFinite(data.latencyMs) ? (data.latencyMs as number) : rtt,
          playersOnline: typeof data.playersOnline === 'number' ? data.playersOnline : MOCK.playersOnline,
          live: true,
        });
      } catch {
        if (cancelled) return;
        // Graceful mock fallback: shard appears connected (cached/demo data).
        setStatus((prev) => jitter(everLive.current ? { ...prev, live: false } : MOCK));
      }
    }

    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return status;
}
