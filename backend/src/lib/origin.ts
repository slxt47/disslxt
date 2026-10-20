import type { FastifyRequest } from 'fastify';
import type { Config } from '../config.js';

/**
 * An Origin is allowed if it matches the request's own host (same-origin) or is listed in
 * ALLOWED_ORIGINS. Requests without an Origin header (non-browser clients) are allowed for
 * plain HTTP; the WS upgrade requires one (see ws.route.ts).
 */
export function isAllowedOrigin(
  origin: string | undefined,
  host: string | undefined,
  config: Pick<Config, 'allowedOrigins'>,
): boolean {
  if (!origin) return false;
  if (config.allowedOrigins.includes(origin)) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function requestOrigin(req: FastifyRequest): string | undefined {
  const o = req.headers.origin;
  return typeof o === 'string' ? o : undefined;
}

/** Host of the request; honours X-Forwarded-Host only when trustProxy is enabled. */
export function requestHost(req: FastifyRequest): string | undefined {
  return req.host || undefined;
}
