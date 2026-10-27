import { describe, expect, it } from 'vitest';
import { passwordProblems, passwordRules, passwordStrength } from './password.js';
import { registerSchema } from './schemas.js';

const ok = (pw: string, ctx = {}) => passwordProblems(pw, ctx).length === 0;

describe('password policy', () => {
  it.each(['Tr0ckenBlume!', 'Kaffee-Ha5e-7', 'zwei katzen auf dem dach', 'Ümläut#Stärke9'])(
    'accepts %s',
    (pw) => expect(passwordProblems(pw)).toEqual([]),
  );

  it('needs 10 characters', () => {
    expect(ok('Ab1!xyzq')).toBe(false);
    expect(passwordRules('Ab1!xyzq').find((r) => r.id === 'length')!.ok).toBe(false);
  });

  it('needs three character classes unless it is a long passphrase', () => {
    expect(ok('kaffeehase')).toBe(false); // one class
    expect(ok('kaffeehase77')).toBe(false); // two classes
    expect(ok('Kaffeehase77')).toBe(true);
    expect(ok('kaffee hase am see')).toBe(true); // 18 chars passphrase
  });

  it.each([
    'Passwort123!',
    'Sommer2024!!',
    'P@ssw0rd1234',
    'Qwertzuiop1!',
    '1234567890Ab!',
    'Abcdefghij1!',
  ])('rejects the common password %s', (pw) =>
    expect(passwordRules(pw).find((r) => r.id === 'common')!.ok).toBe(false),
  );

  it('rejects passwords containing the username or the e-mail name', () => {
    const ctx = { username: 'florian', email: 'flo.neu@example.com' };
    expect(ok('Florian#2026x', ctx)).toBe(false);
    expect(ok('Flo.Neu!rocks', ctx)).toBe(false);
    expect(ok('Gelbe!Tulpe88', ctx)).toBe(true);
  });

  it('rejects runs of four identical characters', () => {
    expect(ok('Haaaallo!123')).toBe(false);
    expect(ok('Haallo!12345x')).toBe(true);
  });

  it('strength grows with length and variety', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abc')).toBe(0);
    expect(passwordStrength('passwort1234')).toBe(1);
    expect(passwordStrength('Tr0ckenBlume!')).toBe(2);
    expect(passwordStrength('Tr0ckenBlumeHut')).toBe(3);
    expect(passwordStrength('zwei katzen auf dem dach')).toBe(4);
  });

  it('registerSchema reports every unmet rule on the password field', () => {
    const r = registerSchema.safeParse({
      email: 'alice@example.com',
      username: 'alice',
      password: 'alice12345',
    });
    expect(r.success).toBe(false);
    const messages = r.error!.issues.filter((i) => i.path[0] === 'password').map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/3 von 4/),
        expect.stringMatching(/Benutzernamen/),
      ]),
    );
  });
});
