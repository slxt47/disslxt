import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Time-based one-time passwords (RFC 6238): SHA-1, 6 digits, 30 seconds, as apps expect. */
const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(out);
}

/** 160 random bits, the size RFC 4226 recommends. */
export const newTotpSecret = (): string => base32Encode(randomBytes(20));

export function hotp(secret: Buffer, counter: bigint): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 15;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

export const currentStep = (nowMs = Date.now()): bigint =>
  BigInt(Math.floor(nowMs / 1000 / STEP_SECONDS));

/**
 * The time step this code belongs to, or null. One step either way tolerates clock drift. Only
 * steps after `lastStep` count, so a code seen once cannot be used again.
 */
export function matchTotp(
  secret: string,
  code: string,
  lastStep: bigint,
  nowMs = Date.now(),
): bigint | null {
  const key = base32Decode(secret);
  const given = Buffer.from(code);
  const now = currentStep(nowMs);
  for (const step of [now - 1n, now, now + 1n]) {
    const expected = Buffer.from(hotp(key, step));
    if (expected.length === given.length && timingSafeEqual(expected, given) && step > lastStep) {
      return step;
    }
  }
  return null;
}

export function totpUri(secret: string, account: string, issuer = 'disslxt'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
