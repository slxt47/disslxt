import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { WS_CLOSE, wsClientMessageSchema, type WsClientMessage } from '@disslxt/shared';
import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { isAllowedOrigin, requestHost, requestOrigin } from '../lib/origin.js';
import { sha256 } from '../lib/tokens.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import type { Services } from '../services/index.js';
import { sendTo, type Client, type Hub } from './hub.js';

/** Max accepted client frame size: control messages plus WebRTC SDP offers (a few KB). */
export const MAX_FRAME_BYTES = 16 * 1024;
/**
 * Per socket and second. WebRTC signalling comes in bursts (a host with many network interfaces
 * yields a hundred ICE candidates at once), so it has its own, larger budget: a burst must never
 * cost a control frame such as voice.leave.
 */
const MAX_SIGNALS_PER_SECOND = 300;
const MAX_CONTROL_FRAMES_PER_SECOND = 30;

/**
 * GET /ws — authenticated WebSocket. Origin and the `sid` cookie are checked on upgrade; on failure
 * the socket is accepted and immediately closed with 4403 / 4401.
 */
export async function wsRoutes(
  app: FastifyInstance,
  opts: { services: Services; hub: Hub; config: Config },
): Promise<void> {
  const { hub, services, config } = opts;

  /** Terminates a socket and drops it from the hub right away (removeClient is idempotent, the
   *  later `close` event is a no-op then). */
  const drop = (client: Client): void => {
    client.socket.terminate();
    hub.removeClient(client);
  };

  // Heartbeat: ping every interval, terminate sockets that missed the previous pong.
  const heartbeat = setInterval(() => {
    for (const client of hub.allClients()) {
      if (!client.isAlive || client.socket.readyState !== client.socket.OPEN) {
        drop(client);
        continue;
      }
      client.isAlive = false;
      try {
        client.socket.ping();
      } catch {
        drop(client);
      }
    }
  }, config.wsHeartbeatMs);
  heartbeat.unref();
  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    for (const client of hub.allClients()) drop(client);
  });

  app.get('/ws', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    // Buffer frames that arrive while the connection is still being authenticated.
    const queue: WsClientMessage[] = [];
    /** Set once queued frames are drained; from then on frames are handled directly. */
    let client: Client | null = null;
    /** Set as soon as the socket is in the hub, so `close` always removes it again. */
    let registered: Client | null = null;
    let closed = false;

    let windowStart = Date.now();
    const counts = { signal: 0, control: 0 };
    socket.on('message', (raw, isBinary) => {
      const msg = decode(raw, isBinary);
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        counts.signal = 0;
        counts.control = 0;
      }
      const kind = msg?.type === 'voice.signal' ? 'signal' : 'control';
      const max = kind === 'signal' ? MAX_SIGNALS_PER_SECOND : MAX_CONTROL_FRAMES_PER_SECOND;
      if (++counts[kind] > max) {
        if (counts[kind] === max + 1) {
          socket.send(JSON.stringify({ type: 'error', data: { code: 'RATE_LIMITED' } }));
        }
        return;
      }
      if (!msg) {
        socket.send(JSON.stringify({ type: 'error', data: { code: 'BAD_REQUEST' } }));
        return;
      }
      if (client) void handle(client, msg);
      else queue.push(msg);
    });
    socket.on('close', () => {
      closed = true;
      if (registered) hub.removeClient(registered);
    });
    socket.on('error', (err) => req.log.warn({ err }, 'ws error'));

    void (async () => {
      if (!isAllowedOrigin(requestOrigin(req), requestHost(req), config)) {
        socket.close(WS_CLOSE.BAD_ORIGIN, 'bad origin');
        return;
      }
      const token = req.cookies[SESSION_COOKIE];
      const user = token ? await services.auth.getUserBySession(token) : null;
      if (!user || !token) {
        socket.close(WS_CLOSE.UNAUTHORIZED, 'unauthorized');
        return;
      }
      const guildIds = await services.guilds.guildIdsForUser(user.id);
      if (closed) return;
      const c: Client = {
        socket,
        userId: user.id,
        username: user.username,
        sessionHash: sha256(token),
        guildIds: new Set(guildIds),
        channel: null,
        visible: true,
        voice: null,
        isAlive: true,
      };
      socket.on('pong', () => {
        c.isAlive = true;
      });
      sendTo(c, { type: 'ready', data: { userId: user.id } });
      hub.addClient(c);
      registered = c;
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) await handle(c, next);
      }
      if (closed) {
        // Closed while draining: the close handler already removed it; removal is idempotent.
        hub.removeClient(c);
        return;
      }
      client = c;
    })().catch((err: unknown) => {
      req.log.error({ err }, 'ws setup failed');
      socket.close(1011, 'internal error');
    });
  });

  async function handle(client: Client, msg: WsClientMessage): Promise<void> {
    switch (msg.type) {
      case 'ping':
        sendTo(client, { type: 'pong' });
        return;
      case 'visibility':
        client.visible = msg.data.visible;
        return;
      case 'voice.leave':
        hub.leaveVoice(client, 'left');
        return;
      case 'voice.mute':
        hub.setVoiceMuted(client, msg.data.muted);
        return;
      case 'voice.signal':
        // A peer that just left is not an error worth reporting; the client cleans up on
        // voice.peer-left.
        hub.relaySignal(client, msg.data.to, msg.data.signal);
        return;
      case 'voice.join': {
        const { channelId } = msg.data;
        try {
          const channel = await services.channels.assertAccess(client.userId, channelId);
          if (client.socket.readyState !== client.socket.OPEN) return;
          if (channel.kind !== 'voice') {
            sendTo(client, {
              type: 'error',
              data: { code: 'BAD_REQUEST', channelId, message: 'Kein Sprachkanal' },
            });
            return;
          }
          const result = hub.joinVoice(client, channel);
          if (!result.ok) {
            sendTo(client, {
              type: 'error',
              data: { code: 'VOICE_FULL', channelId, message: 'Der Sprachkanal ist voll' },
            });
            return;
          }
          if (result.first) {
            services.push.voiceStarted(channelId, { id: client.userId, username: client.username });
          }
        } catch (err) {
          if (err instanceof AppError && (err.statusCode === 403 || err.statusCode === 404)) {
            const code = err.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN';
            sendTo(client, { type: 'error', data: { code, channelId } });
            return;
          }
          app.log.error({ err }, 'voice join failed');
          sendTo(client, { type: 'error', data: { code: 'BAD_REQUEST', channelId } });
        }
        return;
      }
      case 'unsubscribe':
        hub.unsubscribe(client, msg.data.channelId);
        sendTo(client, { type: 'unsubscribed', data: { channelId: msg.data.channelId } });
        return;
      case 'subscribe': {
        const { channelId } = msg.data;
        try {
          const channel = await services.channels.assertAccess(client.userId, channelId);
          if (client.socket.readyState !== client.socket.OPEN) return;
          hub.subscribe(client, channel.id, channel.guildId);
          sendTo(client, { type: 'subscribed', data: { channelId } });
        } catch (err) {
          if (err instanceof AppError && (err.statusCode === 403 || err.statusCode === 404)) {
            const code = err.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN';
            sendTo(client, { type: 'error', data: { code, channelId } });
            return;
          }
          app.log.error({ err }, 'ws subscribe failed');
          sendTo(client, { type: 'error', data: { code: 'BAD_REQUEST', channelId } });
        }
        return;
      }
    }
  }
}

function decode(raw: unknown, isBinary: boolean): WsClientMessage | null {
  if (isBinary) return null;
  const buf = Array.isArray(raw) ? Buffer.concat(raw as Buffer[]) : (raw as Buffer);
  if (buf.length > MAX_FRAME_BYTES) return null;
  try {
    const r = wsClientMessageSchema.safeParse(JSON.parse(buf.toString('utf8')));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
