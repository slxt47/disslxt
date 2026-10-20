import { createHash, randomBytes, randomInt } from 'node:crypto';

/** 32 random bytes, base64url encoded (43 chars). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Random 10-character base62 invite code (~59 bits of entropy). */
export function inviteCode(length = 10): string {
  let out = '';
  for (let i = 0; i < length; i++) out += BASE62[randomInt(BASE62.length)];
  return out;
}
