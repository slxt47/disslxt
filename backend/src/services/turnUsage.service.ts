import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { turnUsage } from '../db/schema.js';

/** Largest single report accepted: 15 s of a full six-person call is a few MB, this is ample. */
export const MAX_REPORT_BYTES = 50_000_000;
const CACHE_MS = 60_000;

export const currentMonth = (now = new Date()) => now.toISOString().slice(0, 7);

/**
 * Counts the bytes relayed through TURN this month. The clients measure their own relayed traffic
 * (WebRTC stats of the selected candidate pair) and report it; sent and received both count, which
 * is on the safe side of what the provider bills.
 */
export class TurnUsageService {
  private cache: { month: string; bytes: number; at: number } | null = null;

  constructor(
    private readonly db: Database,
    private readonly limitBytes: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async add(bytes: number): Promise<void> {
    const amount = Math.min(Math.max(0, Math.floor(bytes)), MAX_REPORT_BYTES);
    if (amount === 0) return;
    const month = currentMonth(this.now());
    await this.db
      .insert(turnUsage)
      .values({ month, bytes: amount })
      .onConflictDoUpdate({
        target: turnUsage.month,
        set: { bytes: sql`${turnUsage.bytes} + ${amount}`, updatedAt: sql`now()` },
      });
    this.cache = null;
  }

  async status(): Promise<{
    month: string;
    usedBytes: number;
    limitBytes: number;
    exhausted: boolean;
  }> {
    const month = currentMonth(this.now());
    if (!this.cache || this.cache.month !== month || Date.now() - this.cache.at > CACHE_MS) {
      const [row] = await this.db.select().from(turnUsage).where(eq(turnUsage.month, month));
      this.cache = { month, bytes: row?.bytes ?? 0, at: Date.now() };
    }
    const usedBytes = this.cache.bytes;
    return {
      month,
      usedBytes,
      limitBytes: this.limitBytes,
      exhausted: usedBytes >= this.limitBytes,
    };
  }
}
