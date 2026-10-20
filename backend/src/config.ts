import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  COOKIE_SECURE: bool.default(false),
  TRUST_PROXY: bool.default(false),
  SESSION_TTL_DAYS: z.coerce.number().positive().default(30),
  ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MESSAGE_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_MESSAGE_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  WS_HEARTBEAT_MS: z.coerce.number().int().positive().default(30_000),
});

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  port: number;
  host: string;
  logLevel: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  sessionTtlDays: number;
  allowedOrigins: string[];
  rateLimit: {
    loginMax: number;
    loginWindowMs: number;
    messageMax: number;
    messageWindowMs: number;
  };
  wsHeartbeatMs: number;
}

/** Parses configuration from environment variables. Throws on invalid input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    cookieSecure: e.COOKIE_SECURE,
    trustProxy: e.TRUST_PROXY,
    sessionTtlDays: e.SESSION_TTL_DAYS,
    allowedOrigins: e.ALLOWED_ORIGINS,
    rateLimit: {
      loginMax: e.RATE_LIMIT_LOGIN_MAX,
      loginWindowMs: e.RATE_LIMIT_LOGIN_WINDOW_MS,
      messageMax: e.RATE_LIMIT_MESSAGE_MAX,
      messageWindowMs: e.RATE_LIMIT_MESSAGE_WINDOW_MS,
    },
    wsHeartbeatMs: e.WS_HEARTBEAT_MS,
  };
}

/**
 * Loads `.env` from the current directory or the repo root (dev convenience) without
 * overriding variables that are already set. Missing files are ignored.
 */
export function loadDotEnv(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    fileURLToPath(new URL('../../.env', import.meta.url)),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const parsed = parseEnv(readFileSync(file, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
    return;
  }
}
