/** Slash commands of the composer. They run here and send ordinary text (or an error). */

export interface SlashCommand {
  name: string;
  args: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'shrug', args: '[Text]', description: 'Hängt ¯\\_(ツ)_/¯ an' },
  { name: 'tableflip', args: '[Text]', description: 'Wirft den Tisch um' },
  { name: 'unflip', args: '[Text]', description: 'Stellt den Tisch wieder hin' },
  { name: 'me', args: 'Text', description: 'Schreibt den Text kursiv, wie eine Handlung' },
  { name: 'würfeln', args: '[Seiten]', description: 'Würfelt, Standard sind 6 Seiten' },
  { name: 'münze', args: '', description: 'Wirft eine Münze' },
  { name: 'umfrage', args: 'Frage | A | B', description: 'Startet eine Umfrage' },
  { name: 'termin', args: '8.11. 20:00 | Titel', description: 'Legt einen Termin mit Zusagen an' },
  { name: 'später', args: '30m Text', description: 'Sendet die Nachricht später' },
  { name: 'erinnern', args: '1h Text', description: 'Erinnert nur dich' },
];

/** Uniform random number 1…max (no modulo bias). */
function randomUpTo(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while ((buf[0] ?? 0) >= limit);
  return ((buf[0] ?? 0) % max) + 1;
}

/**
 * "30m", "2h", "3d", "20:00" (next time it is that late), "8.11.", "8.11. 20:00", "8.11.2027 20:00".
 * Returns the time and what is left of the text; a date without a time means 9:00.
 */
export function parseWhen(input: string, now = new Date()): { at: Date; rest: string } | null {
  const span = /^(\d+)\s*(m|min|h|std|d|t)\b\s*([\s\S]*)$/i.exec(input);
  if (span) {
    const unit = (span[2] ?? '').toLowerCase();
    const minutes = unit.startsWith('m') ? 1 : unit === 'd' || unit === 't' ? 1440 : 60;
    return {
      at: new Date(now.getTime() + Number(span[1]) * minutes * 60_000),
      rest: (span[3] ?? '').trim(),
    };
  }
  const date =
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})?(?:\s+(\d{1,2}):(\d{2}))?(?![\d:])\s*([\s\S]*)$/.exec(input);
  if (date) {
    const [, day, month, year, hour, minute, rest] = date;
    const at = new Date(
      Number(year ?? now.getFullYear()),
      Number(month) - 1,
      Number(day),
      Number(hour ?? 9),
      Number(minute ?? 0),
    );
    if (Number.isNaN(at.getTime()) || at.getDate() !== Number(day)) return null;
    if (!year && at <= now) at.setFullYear(at.getFullYear() + 1);
    return { at, rest: (rest ?? '').trim() };
  }
  const time = /^(\d{1,2}):(\d{2})(?![\d:])\s*([\s\S]*)$/.exec(input);
  if (time) {
    const at = new Date(now);
    at.setHours(Number(time[1]), Number(time[2]), 0, 0);
    if (Number(time[1]) > 23 || Number(time[2]) > 59) return null;
    if (at <= now) at.setDate(at.getDate() + 1);
    return { at, rest: (time[3] ?? '').trim() };
  }
  return null;
}

export type CommandResult =
  | { text: string }
  | { error: string }
  | { poll: { question: string; options: string[] } }
  | { schedule: { kind: 'send' | 'remind'; content: string; sendAt: string } }
  | { event: { title: string; startsAt: string } }
  | null;

/** The text to send for a command; null when it is no command (normal message). */
export function runCommand(input: string, random = randomUpTo): CommandResult {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!match) return null;
  // "//text" sends a line that starts with a slash.
  if (input.trim().startsWith('//')) return { text: input.trim().slice(1) };
  const name = (match[1] ?? '').toLowerCase();
  const arg = (match[2] ?? '').trim();
  const after = (s: string) => ({ text: arg ? `${arg} ${s}` : s });
  switch (name) {
    case 'shrug':
      return after('¯\\\\\\_(ツ)\\_/¯');
    case 'tableflip':
      return after('(╯°□°)╯︵ ┻━┻');
    case 'unflip':
      return after('┬─┬ノ( º \\_ ºノ)');
    case 'me':
      return arg ? { text: `*${arg}*` } : { error: 'Schreib dazu, was du tust: /me winkt' };
    case 'würfeln':
    case 'wuerfeln':
    case 'roll': {
      const sides = arg ? Number(arg) : 6;
      if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
        return { error: 'Würfel: 2 bis 1000 Seiten, zum Beispiel /würfeln 20' };
      }
      return { text: `🎲 hat eine **${random(sides)}** gewürfelt (1–${sides})` };
    }
    case 'umfrage':
    case 'poll': {
      const [question = '', ...options] = arg
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean);
      if (!question || options.length < 2) {
        return { error: 'So geht es: /umfrage Frage | Antwort A | Antwort B' };
      }
      return { poll: { question, options } };
    }
    case 'später':
    case 'spaeter':
    case 'erinnern': {
      const when = parseWhen(arg);
      if (!when || !when.rest) {
        return { error: `So geht es: /${name} 30m Text (auch 2h, 3d, 20:00, 8.11. 20:00)` };
      }
      return {
        schedule: {
          kind: name === 'erinnern' ? 'remind' : 'send',
          content: when.rest,
          sendAt: when.at.toISOString(),
        },
      };
    }
    case 'termin': {
      const [left = '', ...title] = arg.split('|');
      const when = parseWhen(left.trim());
      const text = (title.join('|').trim() || when?.rest) ?? '';
      if (!when || !text) return { error: 'So geht es: /termin 8.11. 20:00 | Spieleabend' };
      return { event: { title: text, startsAt: when.at.toISOString() } };
    }
    case 'münze':
    case 'muenze':
    case 'coin':
      return { text: `🪙 **${random(2) === 1 ? 'Kopf' : 'Zahl'}**` };
    default:
      return null;
  }
}
