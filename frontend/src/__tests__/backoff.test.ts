import { describe, expect, it } from 'vitest';
import { BACKOFF_MAX_MS, nextDelay } from '../realtime/backoff';

describe('nextDelay', () => {
  it('doubles from 500 ms without jitter (random → 1)', () => {
    const almostOne = () => 0.999999;
    const delays = [0, 1, 2, 3, 4].map((a) => nextDelay(a, almostOne));
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it('is capped at 10 s', () => {
    for (const attempt of [5, 6, 10, 50]) {
      expect(nextDelay(attempt, () => 0.999999)).toBeLessThanOrEqual(BACKOFF_MAX_MS);
    }
    expect(nextDelay(20, () => 0.999999)).toBe(BACKOFF_MAX_MS);
  });

  it('applies jitter between 50 % and 100 %', () => {
    expect(nextDelay(2, () => 0)).toBe(1000);
    expect(nextDelay(2, () => 0.5)).toBe(1500);
    for (let i = 0; i < 100; i++) {
      const d = nextDelay(3);
      expect(d).toBeGreaterThanOrEqual(2000);
      expect(d).toBeLessThanOrEqual(4000);
    }
  });

  it('grows monotonically (upper bound) with the attempt number', () => {
    let prev = 0;
    for (let a = 0; a < 8; a++) {
      const d = nextDelay(a, () => 0.999999);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});
