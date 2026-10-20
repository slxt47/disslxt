export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 10_000;

/**
 * Reconnect delay for the given attempt (0-based): min(10 s, 500 ms × 2^attempt), scaled by a
 * jitter factor in [0.5, 1).
 */
export function nextDelay(attempt: number, random: () => number = Math.random): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(exp * (0.5 + 0.5 * random()));
}
