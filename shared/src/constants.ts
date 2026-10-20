export const MESSAGE_MAX_LEN = 2000;
export const PAGE_DEFAULT = 50;
export const PAGE_MAX = 100;

export const GUILD_NAME_MAX_LEN = 100;
export const CHANNEL_NAME_MAX_LEN = 32;
export const USERNAME_MIN_LEN = 3;
export const USERNAME_MAX_LEN = 32;
export const PASSWORD_MIN_LEN = 8;
export const PASSWORD_MAX_LEN = 128;
export const EMAIL_MAX_LEN = 254;
export const DEFAULT_CHANNEL_NAME = 'general';

/** WebSocket close codes used by the server. */
export const WS_CLOSE = {
  /** Missing/invalid session. Clients must NOT reconnect; redirect to login. */
  UNAUTHORIZED: 4401,
  /** Origin not allowed. */
  BAD_ORIGIN: 4403,
} as const;
