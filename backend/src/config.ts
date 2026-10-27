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
  PUBLIC_URL: z
    .url()
    .refine((u) => !u.endsWith('/'), 'PUBLIC_URL must not end with a slash')
    .default('http://localhost:5173'),
  // 'log' keeps mails in memory and logs them; it exists for tests and local development only
  // and is rejected in production.
  MAIL_TRANSPORT: z.enum(['smtp', 'log']).default('log'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  // false = STARTTLS on 587 (iCloud); true = implicit TLS on 465.
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default(''),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().positive().max(168).default(24),
  MAIL_MAX_PER_ADDRESS_PER_HOUR: z.coerce.number().int().positive().default(3),
  RATE_LIMIT_MAIL_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_MAIL_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60_000),
  // Web Push (VAPID). Without both keys push is switched off; the rest of the app still works.
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  // Contact for the push services (mailto: or https:), defaults to PUBLIC_URL.
  VAPID_SUBJECT: z.string().default(''),
  // 'memory' records pushes instead of sending them (E2E); rejected in production.
  PUSH_TRANSPORT: z.enum(['webpush', 'memory']).default('webpush'),
  // Voice messages are stored below this directory (a Docker volume in production).
  UPLOAD_DIR: z.string().default('data/uploads'),
  // auto: convert to AAC with ffmpeg if it is installed, else keep the original upload.
  VOICE_TRANSCODE: z.enum(['auto', 'ffmpeg', 'off']).default('auto'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  // Live voice: STUN (comma separated) and optional TURN (Cloudflare Realtime or own server).
  VOICE_STUN_URLS: z.string().default('stun:stun.cloudflare.com:3478'),
  CLOUDFLARE_TURN_KEY_ID: z.string().default(''),
  CLOUDFLARE_TURN_API_TOKEN: z.string().default(''),
  TURN_URLS: z.string().default(''),
  TURN_USERNAME: z.string().default(''),
  TURN_CREDENTIAL: z.string().default(''),
  // TURN is switched off for the rest of the month once this much was relayed (Cloudflare: first
  // 1000 GB free; the default keeps a margin for credentials still in use and unmeasured traffic).
  TURN_MONTHLY_LIMIT_GB: z.coerce.number().positive().default(900),
});

export interface MailConfig {
  transport: 'smtp' | 'log';
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string };
  from: string;
  verificationTtlHours: number;
  maxPerAddressPerHour: number;
}

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
  transport: 'webpush' | 'memory';
}

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
    mailMax: number;
    mailWindowMs: number;
  };
  wsHeartbeatMs: number;
  publicUrl: string;
  mail: MailConfig;
  /** null = push disabled (no VAPID keys). */
  push: PushConfig | null;
  ice: {
    stunUrls: string[];
    cloudflare: { keyId: string; apiToken: string } | null;
    static: { urls: string[]; username: string; credential: string } | null;
    monthlyLimitBytes: number;
  };
  files: {
    /** Absolute directory for shared files. */
    dir: string;
  };
  voice: {
    /** Absolute directory for voice message files. */
    dir: string;
    transcode: 'auto' | 'ffmpeg' | 'off';
    ffmpegPath: string;
    ffprobePath: string;
  };
}

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Parses configuration from environment variables. Throws on invalid input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production') {
    const missing = [
      ...(e.MAIL_TRANSPORT !== 'smtp' ? ['MAIL_TRANSPORT=smtp'] : []),
      ...(e.PUSH_TRANSPORT !== 'webpush' ? ['PUSH_TRANSPORT=webpush'] : []),
      ...(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'PUBLIC_URL'] as const).filter(
        (k) => !env[k],
      ),
    ];
    if (missing.length > 0) {
      throw new Error(`Invalid configuration: production requires ${missing.join(', ')}`);
    }
  }
  if (!!e.VAPID_PUBLIC_KEY !== !!e.VAPID_PRIVATE_KEY) {
    throw new Error('Invalid configuration: set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY');
  }
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
      mailMax: e.RATE_LIMIT_MAIL_MAX,
      mailWindowMs: e.RATE_LIMIT_MAIL_WINDOW_MS,
    },
    wsHeartbeatMs: e.WS_HEARTBEAT_MS,
    publicUrl: e.PUBLIC_URL,
    mail: {
      transport: e.MAIL_TRANSPORT,
      smtp: {
        host: e.SMTP_HOST,
        port: e.SMTP_PORT,
        secure: e.SMTP_SECURE,
        user: e.SMTP_USER,
        pass: e.SMTP_PASS,
      },
      from: e.MAIL_FROM,
      verificationTtlHours: e.EMAIL_VERIFICATION_TTL_HOURS,
      maxPerAddressPerHour: e.MAIL_MAX_PER_ADDRESS_PER_HOUR,
    },
    ice: {
      stunUrls: list(e.VOICE_STUN_URLS),
      cloudflare:
        e.CLOUDFLARE_TURN_KEY_ID && e.CLOUDFLARE_TURN_API_TOKEN
          ? { keyId: e.CLOUDFLARE_TURN_KEY_ID, apiToken: e.CLOUDFLARE_TURN_API_TOKEN }
          : null,
      static: e.TURN_URLS
        ? { urls: list(e.TURN_URLS), username: e.TURN_USERNAME, credential: e.TURN_CREDENTIAL }
        : null,
      monthlyLimitBytes: Math.round(e.TURN_MONTHLY_LIMIT_GB * 1e9),
    },
    files: { dir: resolve(e.UPLOAD_DIR, 'files') },
    voice: {
      dir: resolve(e.UPLOAD_DIR, 'voice'),
      transcode: e.VOICE_TRANSCODE,
      ffmpegPath: e.FFMPEG_PATH,
      ffprobePath: e.FFPROBE_PATH,
    },
    push: e.VAPID_PUBLIC_KEY
      ? {
          publicKey: e.VAPID_PUBLIC_KEY,
          privateKey: e.VAPID_PRIVATE_KEY,
          subject: e.VAPID_SUBJECT || e.PUBLIC_URL,
          transport: e.PUSH_TRANSPORT,
        }
      : null,
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
