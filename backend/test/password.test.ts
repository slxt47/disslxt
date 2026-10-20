import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password.js';

describe('password hashing (argon2id)', () => {
  it('produces an argon2id hash that differs from the plaintext', async () => {
    const hash = await hashPassword('s3cret-password');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('s3cret-password');
  });

  it('verifies correct and rejects wrong passwords', async () => {
    const hash = await hashPassword('s3cret-password');
    expect(await verifyPassword(hash, 's3cret-password')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('uses a random salt per hash', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  it('returns false for malformed hashes instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});
