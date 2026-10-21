import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const CLOUDFLARE_TTL_S = 6 * 60 * 60;
/** Generated Cloudflare credentials are reused this long (well inside their TTL). */
const CACHE_MS = 60 * 60 * 1000;

/**
 * ICE servers for WebRTC. STUN finds the public address; TURN relays the audio when two peers
 * cannot reach each other directly (symmetric NAT, strict firewalls, many mobile networks).
 * The Cloudflare Tunnel only carries HTTP/WebSocket, so media never goes through this server.
 *
 * TURN sources, first match wins: Cloudflare Realtime TURN (short-lived credentials from its
 * API), then a static TURN server from the environment (e.g. an own coturn).
 */
export class IceService {
  private cache: { servers: IceServer[]; until: number } | null = null;

  constructor(
    private readonly config: Pick<Config, 'ice'>,
    private readonly log: FastifyBaseLogger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async servers(): Promise<IceServer[]> {
    const stun: IceServer[] = this.config.ice.stunUrls.length
      ? [{ urls: this.config.ice.stunUrls }]
      : [];
    return [...stun, ...(await this.turn())];
  }

  private async turn(): Promise<IceServer[]> {
    const { cloudflare, static: fixed } = this.config.ice;
    if (cloudflare) {
      if (this.cache && this.cache.until > Date.now()) return this.cache.servers;
      try {
        const servers = await this.cloudflareServers(cloudflare.keyId, cloudflare.apiToken);
        this.cache = { servers, until: Date.now() + CACHE_MS };
        return servers;
      } catch (err) {
        this.log.error({ err }, 'cloudflare TURN credentials failed; continuing without TURN');
      }
    }
    if (fixed)
      return [{ urls: fixed.urls, username: fixed.username, credential: fixed.credential }];
    return [];
  }

  private async cloudflareServers(keyId: string, token: string): Promise<IceServer[]> {
    const res = await this.fetchImpl(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: CLOUDFLARE_TTL_S }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) throw new Error(`cloudflare TURN API answered ${res.status}`);
    const body = (await res.json()) as { iceServers?: IceServer[] | IceServer };
    const list = Array.isArray(body.iceServers)
      ? body.iceServers
      : body.iceServers
        ? [body.iceServers]
        : [];
    // Browsers block port 53; Cloudflare's docs recommend dropping those URLs. STUN comes from
    // our own list, so only the TURN entries are kept.
    return list
      .map((s) => ({
        ...s,
        urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(
          (u) => /^turns?:/.test(u) && !/:53(\?|$)/.test(u),
        ),
      }))
      .filter((s) => s.urls.length > 0 && s.username && s.credential);
  }
}
