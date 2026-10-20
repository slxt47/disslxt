import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient, type ConnectionStatus, type SocketLike } from '../realtime/socket';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  closedWith: number | undefined;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number) {
    this.closedWith = code;
    this.readyState = 3;
  }
  // helpers
  serverReady() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
    this.serverSend({ type: 'ready', data: { userId: 'u1' } });
  }
  serverSend(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

const CH = '11111111-1111-4111-8111-111111111111';

describe('RealtimeClient', () => {
  let sockets: FakeSocket[];
  let events: EventTarget;
  let statuses: ConnectionStatus[];
  let client: RealtimeClient;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    events = new EventTarget();
    statuses = [];
    client = new RealtimeClient({
      url: 'ws://test/ws',
      random: () => 0.999999,
      eventTarget: events,
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    client.onStatus((s) => statuses.push(s));
  });

  afterEach(() => {
    client.stop();
    vi.useRealTimers();
  });

  it('subscribes to the active channel once ready and forwards events', () => {
    const received: string[] = [];
    client.onEvent((e) => received.push(e.type));
    client.setActiveChannel(CH);
    client.start();
    sockets[0]!.serverReady();
    expect(client.getStatus()).toBe('open');
    expect(sockets[0]!.sent).toEqual([{ type: 'subscribe', data: { channelId: CH } }]);
    sockets[0]!.serverSend({ type: 'pong' });
    expect(received).toEqual(['pong']);
  });

  it('reconnects with growing backoff, re-subscribes and reports reconnect', () => {
    const ready: boolean[] = [];
    client.onReady(({ reconnect }) => ready.push(reconnect));
    client.setActiveChannel(CH);
    client.start();
    sockets[0]!.serverReady();

    sockets[0]!.serverClose(1006);
    expect(client.getStatus()).toBe('reconnecting');
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    sockets[1]!.serverClose(1006); // fails again → 1000 ms
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);

    sockets[2]!.serverReady();
    expect(client.getStatus()).toBe('open');
    expect(ready).toEqual([false, true]);
    expect(sockets[2]!.sent).toEqual([{ type: 'subscribe', data: { channelId: CH } }]);
    expect(statuses).toEqual(['connecting', 'open', 'reconnecting', 'open']);
  });

  it('does not reconnect after 4401', () => {
    client.start();
    sockets[0]!.serverReady();
    sockets[0]!.serverClose(4401);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(client.getStatus()).toBe('unauthorized');
  });

  it('drops the socket when the browser goes offline and reconnects immediately when online', () => {
    client.start();
    sockets[0]!.serverReady();
    events.dispatchEvent(new Event('offline'));
    expect(client.getStatus()).toBe('reconnecting');
    expect(sockets[0]!.closedWith).toBe(4000);

    // The scheduled attempt fails while offline …
    vi.advanceTimersByTime(500);
    sockets[1]!.serverClose(1006);
    // … but the online event retries right away instead of waiting for the backoff.
    events.dispatchEvent(new Event('online'));
    expect(sockets).toHaveLength(3);
    sockets[2]!.serverReady();
    expect(client.getStatus()).toBe('open');
  });

  it('switching channels unsubscribes the previous one', () => {
    client.start();
    sockets[0]!.serverReady();
    client.setActiveChannel(CH);
    client.setActiveChannel(null);
    expect(sockets[0]!.sent).toEqual([
      { type: 'subscribe', data: { channelId: CH } },
      { type: 'unsubscribe', data: { channelId: CH } },
    ]);
  });

  it('treats a missing pong as a dead connection', () => {
    client = new RealtimeClient({
      url: 'ws://test/ws',
      random: () => 0.999999,
      eventTarget: events,
      pingIntervalMs: 1000,
      pongTimeoutMs: 500,
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    client.start();
    sockets[0]!.serverReady();
    vi.advanceTimersByTime(1000);
    expect(sockets[0]!.sent).toEqual([{ type: 'ping' }]);
    vi.advanceTimersByTime(500);
    expect(client.getStatus()).toBe('reconnecting');
    expect(sockets[0]!.closedWith).toBe(4000);
  });
});
