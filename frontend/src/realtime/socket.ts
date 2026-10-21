import { WS_CLOSE, type WsClientMessage, type WsServerMessage } from '@disslxt/shared';
import { nextDelay } from './backoff';

/**
 * - `connecting`: first connection attempt.
 * - `open`: authenticated (`ready` received).
 * - `reconnecting`: the connection was lost; retrying with backoff.
 * - `unauthorized`: closed with 4401; no further attempts.
 * - `stopped`: stopped by the app (logout / unmount).
 */
export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'unauthorized' | 'stopped';

/** Minimal WebSocket surface used by the client (lets tests inject a fake). */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RealtimeOptions {
  url?: string;
  createSocket?: (url: string) => SocketLike;
  random?: () => number;
  /** Client-side keepalive: send `ping` this often and drop the socket if nothing arrives. */
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  /** Window-like target for `online`/`offline` events (defaults to `window`). */
  eventTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  /** Document-like source of `visibilitychange` (defaults to `document`). The server skips push
   *  notifications for a channel that is open in a visible tab. */
  visibility?:
    | (Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & {
        visibilityState: string;
      })
    | null;
}

type EventListener = (ev: WsServerMessage) => void;
type StatusListener = (status: ConnectionStatus) => void;
type ReadyListener = (info: { reconnect: boolean }) => void;

const OPEN = 1;

export function defaultSocketUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

/**
 * One WebSocket per tab. Reconnects with exponential backoff (except after 4401), re-subscribes
 * to the active channel and notifies `onReady({reconnect:true})` so the app can refetch state.
 */
export class RealtimeClient {
  private socket: SocketLike | null = null;
  private status: ConnectionStatus = 'stopped';
  private attempt = 0;
  private hadConnection = false;
  private activeChannel: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly eventListeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly readyListeners = new Set<ReadyListener>();
  private readonly opts: Required<Omit<RealtimeOptions, 'url' | 'eventTarget' | 'visibility'>> & {
    url: string | undefined;
    eventTarget: RealtimeOptions['eventTarget'];
    visibility: RealtimeOptions['visibility'];
  };

  constructor(options: RealtimeOptions = {}) {
    this.opts = {
      url: options.url,
      createSocket: options.createSocket ?? ((url) => new WebSocket(url) as SocketLike),
      random: options.random ?? Math.random,
      pingIntervalMs: options.pingIntervalMs ?? 25_000,
      pongTimeoutMs: options.pongTimeoutMs ?? 10_000,
      eventTarget:
        options.eventTarget === undefined
          ? typeof window !== 'undefined'
            ? window
            : null
          : options.eventTarget,
      visibility:
        options.visibility === undefined
          ? typeof document !== 'undefined'
            ? document
            : null
          : options.visibility,
    };
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onReady(listener: ReadyListener): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  start(): void {
    if (this.status !== 'stopped' && this.status !== 'unauthorized') return;
    this.attempt = 0;
    this.hadConnection = false;
    this.opts.eventTarget?.addEventListener('online', this.handleOnline);
    this.opts.eventTarget?.addEventListener('offline', this.handleOffline);
    this.opts.visibility?.addEventListener('visibilitychange', this.sendVisibility);
    this.setStatus('connecting');
    this.connect();
  }

  stop(): void {
    this.opts.eventTarget?.removeEventListener('online', this.handleOnline);
    this.opts.eventTarget?.removeEventListener('offline', this.handleOffline);
    this.opts.visibility?.removeEventListener('visibilitychange', this.sendVisibility);
    this.clearReconnect();
    this.dropSocket(1000);
    this.setStatus('stopped');
  }

  /** Sets the channel this tab listens to (null = none). Re-sent after every reconnect. */
  setActiveChannel(channelId: string | null): void {
    if (channelId === this.activeChannel) return;
    const previous = this.activeChannel;
    this.activeChannel = channelId;
    if (this.status !== 'open') return;
    if (channelId) this.send({ type: 'subscribe', data: { channelId } });
    else if (previous) this.send({ type: 'unsubscribe', data: { channelId: previous } });
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const l of this.statusListeners) l(status);
  }

  private send(msg: WsClientMessage): void {
    if (this.socket && this.socket.readyState === OPEN) this.socket.send(JSON.stringify(msg));
  }

  private connect(): void {
    this.clearReconnect();
    let socket: SocketLike;
    try {
      socket = this.opts.createSocket(this.opts.url ?? defaultSocketUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onmessage = (ev: MessageEvent) => {
      this.resetPongTimer();
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as WsServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        const reconnect = this.hadConnection;
        this.hadConnection = true;
        this.attempt = 0;
        this.setStatus('open');
        this.startPing();
        if (this.opts.visibility?.visibilityState === 'hidden') this.sendVisibility();
        if (this.activeChannel) {
          this.send({ type: 'subscribe', data: { channelId: this.activeChannel } });
        }
        for (const l of this.readyListeners) l({ reconnect });
        return;
      }
      for (const l of this.eventListeners) l(msg);
    };

    socket.onclose = (ev: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopPing();
      if (ev.code === WS_CLOSE.UNAUTHORIZED) {
        this.setStatus('unauthorized');
        return;
      }
      if (this.status === 'stopped') return;
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose follows and handles the reconnect.
    };
  }

  private scheduleReconnect(): void {
    if (this.status === 'stopped' || this.status === 'unauthorized') return;
    this.setStatus(this.hadConnection || this.attempt > 0 ? 'reconnecting' : 'connecting');
    this.clearReconnect();
    const delay = nextDelay(this.attempt, this.opts.random);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Detaches and closes the current socket without waiting for the close handshake. */
  private dropSocket(code?: number): void {
    const socket = this.socket;
    this.socket = null;
    this.stopPing();
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close(code);
    } catch {
      // ignore
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping' });
      if (!this.pongTimer) {
        this.pongTimer = setTimeout(() => this.handleDeadConnection(), this.opts.pongTimeoutMs);
      }
    }, this.opts.pingIntervalMs);
  }

  private resetPongTimer(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.resetPongTimer();
  }

  private handleDeadConnection(): void {
    this.pongTimer = null;
    if (this.status === 'stopped' || this.status === 'unauthorized') return;
    this.dropSocket(4000);
    this.scheduleReconnect();
  }

  private readonly sendVisibility = (): void => {
    const visible = this.opts.visibility?.visibilityState !== 'hidden';
    this.send({ type: 'visibility', data: { visible } });
  };

  private readonly handleOffline = (): void => {
    if (this.status === 'stopped' || this.status === 'unauthorized') return;
    this.dropSocket(4000);
    this.scheduleReconnect();
  };

  private readonly handleOnline = (): void => {
    if (this.status === 'stopped' || this.status === 'unauthorized' || this.status === 'open') {
      return;
    }
    if (this.socket) return; // an attempt is already in flight
    this.attempt = 0;
    this.connect();
  };
}
