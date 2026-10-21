import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN, PASSWORD_PASSPHRASE_LEN } from './constants.js';

/**
 * Password policy (for new passwords; existing ones keep working):
 *  - at least PASSWORD_MIN_LEN characters,
 *  - three of: lower case, upper case, digit, other character – or a passphrase of
 *    PASSWORD_PASSPHRASE_LEN+ characters, where length beats complexity (NIST SP 800-63B),
 *  - not one of the most common passwords (also with digits/symbols appended),
 *  - does not contain the username or the name part of the e-mail address,
 *  - no run of four or more identical characters ("aaaa", "1111").
 * The same checks run in the browser (live checklist) and on the server.
 */

/** Most common passwords (German and international lists), lower case, without trailing digits. */
const COMMON = new Set(
  `password passwort passwort! qwertz qwerty qwertzuiop qwertyuiop asdfgh asdfghjkl yxcvbnm
  zxcvbnm abc abcdef abcdefg abcdefgh letmein welcome willkommen hallo hallo! hello iloveyou
  ichliebedich schatz schatzi master admin administrator root login geheim secret sommer winter
  fruehling herbst frühling football fussball fußball baseball dragon monkey sunshine princess
  shadow superman batman michael jessica daniel thomas andreas stefan sabine nicole christian
  berlin hamburg muenchen münchen deutschland germany austria oesterreich österreich wien
  starwars pokemon minecraft fortnite computer internet samsung iphone google facebook
  trustno1 whatever freedom changeme default test tester testtest benutzer user guest gast
  lol lollol hunter killer ninja flower blumen hase hasi maus mausi baby engel liebe love
  bayern borussia schalke eintracht werder galatasaray fenerbahce disslxt chat discord
  passw0rd p@ssw0rd p@ssword pa$$word passwort1 qwerty1 azerty`.split(/\s+/),
);

export interface PasswordContext {
  username?: string;
  email?: string;
}

export interface PasswordRule {
  id: 'length' | 'variety' | 'common' | 'personal' | 'repeat';
  label: string;
  ok: boolean;
}

function classes(pw: string): number {
  return [/[a-zäöüß]/, /[A-ZÄÖÜ]/, /\d/, /[^A-Za-z0-9äöüßÄÖÜ]/].filter((r) => r.test(pw)).length;
}

/** Core of a password without decoration: "Sommer2024!" → "sommer". */
function core(pw: string): string {
  return pw
    .toLowerCase()
    .replace(/[\d\W_]+$/u, '')
    .replace(/^[\d\W_]+/u, '');
}

/** Straight runs on the number row, the alphabet or the keyboard ("12345678", "qwertzui"). */
const RUNS = [
  '01234567890123456789',
  '98765432109876543210',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertzuiopasdfghjklyxcvbnm',
  'qwertyuiopasdfghjklzxcvbnm',
];

function isCommon(pw: string): boolean {
  const lower = pw.toLowerCase();
  if (COMMON.has(lower) || COMMON.has(core(pw))) return true;
  return RUNS.some((run) => run.includes(lower) || run.includes(core(pw) || lower));
}

function containsPersonal(pw: string, ctx: PasswordContext): boolean {
  const lower = pw.toLowerCase();
  const parts = [ctx.username, ctx.email?.split('@')[0]]
    .map((p) => p?.toLowerCase().trim() ?? '')
    .filter((p) => p.length >= 3);
  return parts.some((p) => lower.includes(p));
}

export function passwordRules(pw: string, ctx: PasswordContext = {}): PasswordRule[] {
  const length = [...pw].length;
  return [
    {
      id: 'length',
      label: `Mindestens ${PASSWORD_MIN_LEN} Zeichen`,
      ok: length >= PASSWORD_MIN_LEN && length <= PASSWORD_MAX_LEN,
    },
    {
      id: 'variety',
      label: `3 von 4: Klein-, Großbuchstaben, Ziffern, Sonderzeichen (oder ab ${PASSWORD_PASSPHRASE_LEN} Zeichen beliebig)`,
      ok: classes(pw) >= 3 || length >= PASSWORD_PASSPHRASE_LEN,
    },
    { id: 'common', label: 'Kein häufig benutztes Passwort', ok: pw.length > 0 && !isCommon(pw) },
    {
      id: 'personal',
      label: 'Enthält nicht deinen Benutzernamen oder deine E-Mail',
      ok: pw.length > 0 && !containsPersonal(pw, ctx),
    },
    {
      id: 'repeat',
      label: 'Kein Zeichen 4× hintereinander',
      ok: pw.length > 0 && !/(.)\1{3}/u.test(pw),
    },
  ];
}

/** Messages for every rule that is not met (empty = acceptable). */
export function passwordProblems(pw: string, ctx: PasswordContext = {}): string[] {
  return passwordRules(pw, ctx)
    .filter((r) => !r.ok)
    .map((r) => r.label);
}

/** 0–4 for a strength meter: 0–1 while a rule fails, then 2–4 by length and variety. */
export function passwordStrength(pw: string, ctx: PasswordContext = {}): number {
  if (!pw) return 0;
  const length = [...pw].length;
  if (passwordProblems(pw, ctx).length > 0) return length >= PASSWORD_MIN_LEN ? 1 : 0;
  if (length >= 20 || (length >= 14 && classes(pw) === 4)) return 4;
  return length >= 14 ? 3 : 2;
}
