import type { GifDto } from '@disslxt/shared';
import { AppError, notFound } from '../lib/errors.js';
import { giphyGif } from './dto.js';

const API = 'https://api.giphy.com/v1/gifs';
const PAGE = 24;
const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 200;

interface GiphyItem {
  id: string;
  title?: string;
  images?: { original?: { width?: string; height?: string } };
}

/**
 * GIF search over the official GIPHY API. The key stays on the server; browsers only get ids and
 * GIPHY CDN links and load the GIFs from GIPHY themselves (embedding, as GIPHY's terms ask).
 * Results are cached for a few minutes so typing does not hammer the API.
 */
export class GifService {
  private readonly cache = new Map<string, { at: number; gifs: GifDto[] }>();

  constructor(
    private readonly apiKey: string | null,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  get enabled(): boolean {
    return this.apiKey !== null;
  }

  /** Trending without a query. */
  async search(q: string | undefined, offset: number): Promise<GifDto[]> {
    const query = q?.trim().toLowerCase() ?? '';
    const key = `${query}|${offset}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.gifs;
    const params = new URLSearchParams({
      limit: String(PAGE),
      offset: String(offset),
      rating: 'pg-13',
    });
    if (query) {
      params.set('q', query);
      params.set('lang', 'de');
    }
    const body = await this.call<{ data: GiphyItem[] }>(query ? '/search' : '/trending', params);
    const gifs = body.data.map(toDto).filter((g): g is GifDto => g !== null);
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: Date.now(), gifs });
    return gifs;
  }

  /** One GIF by id (checked against GIPHY before it is posted). */
  async get(id: string): Promise<GifDto> {
    const body = await this.call<{ data: GiphyItem | [] }>(`/${id}`, new URLSearchParams());
    const gif = Array.isArray(body.data) ? null : toDto(body.data);
    if (!gif) throw notFound('GIF nicht gefunden');
    return gif;
  }

  private async call<T>(path: string, params: URLSearchParams): Promise<T> {
    if (!this.apiKey)
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'GIFs sind nicht eingerichtet');
    params.set('api_key', this.apiKey);
    let res: Response;
    try {
      res = await this.fetchFn(`${API}${path}?${params.toString()}`, {
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'GIPHY ist gerade nicht erreichbar');
    }
    if (res.status === 404) throw notFound('GIF nicht gefunden');
    if (res.status === 429) {
      throw new AppError('RATE_LIMITED', 429, 'Gerade zu viele GIF-Suchen – kurz warten');
    }
    if (!res.ok)
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'GIPHY ist gerade nicht erreichbar');
    return (await res.json()) as T;
  }
}

function toDto(item: GiphyItem): GifDto | null {
  if (!/^[A-Za-z0-9]{4,64}$/.test(item.id ?? '')) return null;
  const w = Math.min(4000, Math.max(1, Number(item.images?.original?.width) || 200));
  const h = Math.min(4000, Math.max(1, Number(item.images?.original?.height) || 200));
  return giphyGif(item.id, w, h, (item.title ?? '').slice(0, 200));
}
