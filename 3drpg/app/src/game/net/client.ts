// ============================================================================
// CORESAPIAN — src/game/net/client.ts (audio-net)
//
// WebSocket transport implementing contracts/netcode.ts EXACTLY:
//  - connect → hello {playerId, name, protocolVersion}
//  - status machine: connecting → connected → (close/error) → reconnecting
//  - constant 3000ms retry (NO backoff, ever); world keeps rendering
//  - 5s heartbeat ping → pong drives setLatency
// Message routing is delegated via callbacks (net/index.ts owns store writes).
// ============================================================================

import type { ConnectionStatus } from '../../../contracts/types';
import {
  HEARTBEAT_MS,
  RECONNECT_INTERVAL_MS,
  isServerMessage,
} from '../../../contracts/netcode';
import type {
  ClientMessage,
  DamageResultMsg,
  HelloMsg,
  InventoryAckMsg,
  InventorySyncMsg,
  PongMsg,
  ServerErrorMsg,
  SnapshotMsg,
  VitalsMsg,
  WelcomeMsg,
  WorldEventMsg,
} from '../../../contracts/netcode';

export interface NetClientCallbacks {
  onStatus(status: ConnectionStatus): void;
  onWelcome(msg: WelcomeMsg): void;
  onSnapshot(msg: SnapshotMsg): void;
  onDamage(msg: DamageResultMsg): void;
  onVitals(msg: VitalsMsg): void;
  onInventoryAck(msg: InventoryAckMsg): void;
  onInventorySync(msg: InventorySyncMsg): void;
  onWorldEvent(msg: WorldEventMsg): void;
  onPong(msg: PongMsg): void;
  onServerError(msg: ServerErrorMsg): void;
  /** Fires once per second while reconnecting (3 → 1) for banner/sfx ticks. */
  onReconnectTick(remainingSeconds: number): void;
  /** Server rubber-band correction (additive message, not in frozen contract). */
  onCorrect?(msg: CorrectMsg): void;
}

/** Server-authoritative position correction (gdd §12.13 rubber-banding). */
export interface CorrectMsg {
  t: 'correct';
  seq: number;
  position: { x: number; y: number; z: number };
  realm: string;
  serverTime: number;
}

export class NetClient {
  private readonly url: string;
  private readonly helloFactory: () => HelloMsg;
  private readonly cb: NetClientCallbacks;

  private ws: WebSocket | null = null;
  private disposed = false;
  private everConnected = false;
  /** True once the auto-retry loop has run (status stays 'reconnecting'). */
  private retryLoopActive = false;
  private reconnectTimer: number | null = null;
  private tickTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectDeadline = 0;

  constructor(url: string, helloFactory: () => HelloMsg, cb: NetClientCallbacks) {
    this.url = url;
    this.helloFactory = helloFactory;
    this.cb = cb;
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Begin (or resume) the connection loop. */
  connect(): void {
    if (this.disposed) return;
    this.clearReconnectTimers();
    this.openSocket(this.everConnected || this.retryLoopActive ? 'reconnecting' : 'connecting');
  }

  /** Send a protocol message. Returns false when the link is down. */
  send(msg: ClientMessage): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      console.warn('[net] send failed', err);
      return false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearReconnectTimers();
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.onopen = null;
        ws.close();
      } catch {
        /* noop */
      }
    }
  }

  // ------------------------------------------------------------- internals

  private openSocket(status: ConnectionStatus): void {
    if (this.disposed) return;
    this.cb.onStatus(status);

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      console.warn('[net] WebSocket construction failed', err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      const hello = this.helloFactory();
      this.send(hello);
    };

    ws.onmessage = (ev: MessageEvent) => {
      this.handleMessage(ev);
    };

    ws.onerror = () => {
      // onclose follows; the close handler drives the state machine.
    };

    ws.onclose = () => {
      if (this.disposed) return;
      this.stopHeartbeat();
      if (this.ws === ws) this.ws = null;
      this.scheduleReconnect();
    };
  }

  private handleMessage(ev: MessageEvent): void {
    if (this.disposed) return;
    let data: unknown;
    try {
      data = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch {
      return; // non-JSON frame: ignore
    }
    if (!isServerMessage(data)) {
      // Additive server messages not in the frozen contract union.
      if ((data as { t?: unknown }).t === 'correct') {
        this.cb.onCorrect?.(data as unknown as CorrectMsg);
      }
      return;
    }

    switch (data.t) {
      case 'welcome':
        this.everConnected = true;
        this.cb.onStatus('connected');
        this.startHeartbeat();
        this.cb.onWelcome(data);
        break;
      case 'snapshot':
        this.cb.onSnapshot(data);
        break;
      case 'dmg':
        this.cb.onDamage(data);
        break;
      case 'vitals':
        this.cb.onVitals(data);
        break;
      case 'invack':
        this.cb.onInventoryAck(data);
        break;
      case 'invsync':
        this.cb.onInventorySync(data);
        break;
      case 'event':
        this.cb.onWorldEvent(data);
        break;
      case 'pong':
        this.cb.onPong(data);
        break;
      case 'error':
        this.cb.onServerError(data);
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    this.retryLoopActive = true;
    this.cb.onStatus('reconnecting');
    this.reconnectDeadline = Date.now() + RECONNECT_INTERVAL_MS;
    this.cb.onReconnectTick(Math.ceil(RECONNECT_INTERVAL_MS / 1000));

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_INTERVAL_MS);

    // 1s countdown ticks (banner "retrying in N" + sfx.reconnect.tick).
    this.tickTimer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((this.reconnectDeadline - Date.now()) / 1000));
      if (remaining > 0) this.cb.onReconnectTick(remaining);
    }, 1000);
  }

  private clearReconnectTimers(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ t: 'ping', clientTime: Date.now() });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/** ws(s)://<host>/ws — same origin as the page (server serves client + /ws). */
export function defaultWsUrl(): string {
  if (typeof window === 'undefined' || !window.location) return 'ws://localhost:3000/ws';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}
