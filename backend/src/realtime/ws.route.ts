import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { WS_CLOSE, wsClientMessageSchema, type WsClientMessage } from '@chat-mvp/shared';
import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { isAllowedOrigin, requestHost, requestOrigin } from '../lib/origin.js';
import { sha256 } from '../lib/tokens.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import type { Services } from '../services/index.js';
import { sendTo, type Client, type Hub } from './hub.js';

/** Max accepted client frame size; clients only send tiny control messages. */
const MAX_FRAME_BYTES = 4096;

/**
 * GET /ws — authenticated WebSocket. Origin and the `sid` cookie are checked on upgrade; on failure
 * the socket is accepted and immediately closed with 4403 / 4401.
 */
export async function wsRoutes(
  app: FastifyInstance,
  opts: { services: Services; hub: Hub; config: Config },
): Promise<void> {
  const { hub, services, config } = opts;

  // Heartbeat: ping every interval, terminate sockets that missed the previous pong.
  const heartbeat = setInterval(() => {
    for (const client of hub.allClients()) {
      if (!client.isAlive) {
        client.socket.terminate();
        continue;
      }
      client.isAlive = false;
      try {
        client.socket.ping();
      } catch {
        client.socket.terminate();
      }
    }
  }, config.wsHeartbeatMs);
  heartbeat.unref();
  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    for (const client of hub.allClients()) client.socket.terminate();
  });

  app.get('/ws', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    // Buffer frames that arrive while the connection is still being authenticated.
    const queue: WsClientMessage[] = [];
    let client: Client | null = null;
    let closed = false;

    socket.on('message', (raw, isBinary) => {
      const msg = decode(raw, isBinary);
      if (!msg) {
        socket.send(JSON.stringify({ type: 'error', data: { code: 'BAD_REQUEST' } }));
        return;
      }
      if (client) void handle(client, msg);
      else queue.push(msg);
    });
    socket.on('close', () => {
      closed = true;
      if (client) hub.removeClient(client);
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
        sessionHash: sha256(token),
        guildIds: new Set(guildIds),
        channel: null,
        isAlive: true,
      };
      socket.on('pong', () => {
        c.isAlive = true;
      });
      sendTo(c, { type: 'ready', data: { userId: user.id } });
      hub.addClient(c);
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) await handle(c, next);
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
