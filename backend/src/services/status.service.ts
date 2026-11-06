import type { StatusEntryDto } from '@disslxt/shared';

const MAX_AGE_MS = 60_000;
const TIMEOUT_MS = 8000;

/** "Name=https://…,Name=https://…"; set by the operator, never by users. */
export function parseStatusTargets(raw: string): { name: string; url: string }[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .flatMap((part) => {
      const at = part.indexOf('=');
      const name = part.slice(0, at).trim();
      const url = part.slice(at + 1).trim();
      return at > 0 && /^https?:\/\//.test(url) ? [{ name, url }] : [];
    });
}

/** Which of the operator's services answer; at most one round per minute, however many ask. */
export class StatusService {
  private cache: { at: number; entries: Promise<StatusEntryDto[]> } | null = null;

  constructor(
    private readonly targets: { name: string; url: string }[],
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async check(target: { name: string; url: string }): Promise<StatusEntryDto> {
    const started = Date.now();
    try {
      const res = await this.fetchFn(target.url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // A login page or redirect also means the service is there.
      return { name: target.name, up: res.status < 500, ms: Date.now() - started };
    } catch {
      return { name: target.name, up: false, ms: null };
    }
  }

  board(): Promise<StatusEntryDto[]> {
    if (!this.cache || Date.now() - this.cache.at > MAX_AGE_MS) {
      this.cache = {
        at: Date.now(),
        entries: Promise.all(this.targets.map((t) => this.check(t))),
      };
    }
    return this.cache.entries;
  }
}
