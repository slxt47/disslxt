export const MESSAGE_MAX_LEN = 2000;
export const PAGE_DEFAULT = 50;
export const PAGE_MAX = 100;

export const GUILD_NAME_MAX_LEN = 100;
export const CHANNEL_NAME_MAX_LEN = 32;
export const USERNAME_MIN_LEN = 3;
export const USERNAME_MAX_LEN = 32;
export const DISPLAY_NAME_MAX_LEN = 32;
export const STATUS_TEXT_MAX_LEN = 80;
/** Servers one person may create (owned servers). */
export const GUILDS_PER_USER_MAX = 5;
/** "Passwort vergessen" links stay valid this long. */
export const PASSWORD_RESET_TTL_MINUTES = 30;
export const PASSWORD_MIN_LEN = 10;
/** From this length any password counts as a passphrase (no character-class rule). */
export const PASSWORD_PASSPHRASE_LEN = 16;
export const PASSWORD_MAX_LEN = 128;
export const EMAIL_MAX_LEN = 254;
export const NEXT_PATH_MAX_LEN = 200;
export const DEFAULT_CHANNEL_NAME = 'general';

/** Live voice channels are a WebRTC mesh: every participant sends to every other one, so the
 *  upload grows with the room. Six keeps it workable on phones. */
export const VOICE_CHANNEL_MAX_PARTICIPANTS = 6;

/** Shared files: largest upload accepted. */
export const FILE_MAX_BYTES = 25 * 1024 * 1024;
export const FILE_NAME_MAX_LEN = 200;

/** Profile and server pictures (resized in the browser to 256 px before upload). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** Pending friend requests one person can have open at a time (spam brake). */
export const FRIEND_REQUESTS_MAX_PENDING = 50;

/** Group chats: everyone in it, including yourself (calls stay a mesh of at most 6). */
export const GROUP_MAX_MEMBERS = 10;
export const GROUP_NAME_MAX_LEN = 32;

/** Voice messages: longest recording and largest upload accepted. */
export const VOICE_MAX_SECONDS = 120;
export const VOICE_MAX_BYTES = 5 * 1024 * 1024;
/** Container formats browsers record in (Chrome/Firefox: WebM/Ogg Opus, Safari: MP4/AAC). */
export const VOICE_UPLOAD_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/aac',
  'audio/mpeg',
  'audio/wav',
] as const;

/** WebSocket close codes used by the server. */
export const WS_CLOSE = {
  /** Missing/invalid session. Clients must NOT reconnect; redirect to login. */
  UNAUTHORIZED: 4401,
  /** Origin not allowed. */
  BAD_ORIGIN: 4403,
} as const;
