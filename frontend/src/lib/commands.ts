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
];

/** Uniform random number 1…max (no modulo bias). */
function randomUpTo(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while ((buf[0] ?? 0) >= limit);
  return ((buf[0] ?? 0) % max) + 1;
}

export type CommandResult = { text: string } | { error: string } | null;

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
    case 'münze':
    case 'muenze':
    case 'coin':
      return { text: `🪙 **${random(2) === 1 ? 'Kopf' : 'Zahl'}**` };
    default:
      return null;
  }
}
