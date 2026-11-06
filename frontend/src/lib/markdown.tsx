import type { ReactNode } from 'react';

/**
 * Small Markdown for chat messages: **fett**, *kursiv*, _kursiv_, ~~durch~~, `Code`, ```Block```,
 * Links and @mentions. It builds React elements, never HTML, so text cannot inject anything.
 * Hand-written on purpose: lookbehind in a RegExp would break the whole bundle on older Safari.
 */

const WORD = /[A-Za-z0-9_äöüÄÖÜß]/;
const URL_START = /^https?:\/\/[^\s<>]+/i;
const MENTION = /^@([A-Za-z0-9_]{3,32})(?![A-Za-z0-9_])/;
const MAX_DEPTH = 3;

/** Punctuation right after a link belongs to the sentence, not the link. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url[url.length - 1] ?? '';
    if ('.,;:!?\'"'.includes(last) && last) url = url.slice(0, -1);
    else if (last === ')' && !url.includes('(')) url = url.slice(0, -1);
    else return url;
  }
}

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** The closing marker, or -1: not right after a space, and for `*`/`_` not inside a word. */
function closing(text: string, marker: string, from: number, wordBound: boolean): number {
  for (let at = text.indexOf(marker, from); at !== -1; at = text.indexOf(marker, at + 1)) {
    const before = text[at - 1] ?? ' ';
    const after = text[at + marker.length] ?? ' ';
    if (/\s/.test(before) || at === from) continue;
    if (wordBound && WORD.test(after)) continue;
    // In "***" the last two (or the last one) close: an inner *…* ends first.
    if (after === marker[0]) continue;
    return at;
  }
  return -1;
}

function inline(text: string, selfName: string | null, depth: number, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = '';
  let i = 0;
  const flush = () => {
    if (plain) out.push(plain);
    plain = '';
  };
  const wrap = (node: (id: string) => ReactNode, nextIndex: number) => {
    flush();
    out.push(node(`${key}-${i}`));
    i = nextIndex;
  };

  while (i < text.length) {
    const c = text[i] ?? '';
    const prev = text[i - 1] ?? ' ';
    const canOpen = depth < MAX_DEPTH;

    if (c === '\\' && '\\`*_~@'.includes(text[i + 1] ?? ' ')) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      const body = end > i + 1 ? text.slice(i + 1, end) : '';
      if (body && !body.includes('\n')) {
        wrap((id) => <code key={id}>{body}</code>, end + 1);
        continue;
      }
    } else if (canOpen && (text.startsWith('**', i) || text.startsWith('~~', i))) {
      const marker = text.slice(i, i + 2);
      const next = text[i + 2] ?? ' ';
      const end = /\s/.test(next) ? -1 : closing(text, marker, i + 2, false);
      if (end !== -1) {
        const inner = inline(text.slice(i + 2, end), selfName, depth + 1, `${key}-${i}`);
        wrap(
          (id) => (marker === '**' ? <strong key={id}>{inner}</strong> : <s key={id}>{inner}</s>),
          end + 2,
        );
        continue;
      }
    } else if (canOpen && (c === '*' || c === '_') && !WORD.test(prev)) {
      const next = text[i + 1] ?? ' ';
      const end = /\s/.test(next) || next === c ? -1 : closing(text, c, i + 1, true);
      if (end !== -1 && !text.slice(i, end).includes('\n')) {
        const inner = inline(text.slice(i + 1, end), selfName, depth + 1, `${key}-${i}`);
        wrap((id) => <em key={id}>{inner}</em>, end + 1);
        continue;
      }
    } else if ((c === 'h' || c === 'H') && !WORD.test(prev)) {
      const match = URL_START.exec(text.slice(i, i + 2048));
      const url = match ? trimUrl(match[0]) : '';
      const href = url ? safeHref(url) : null;
      if (href) {
        wrap(
          (id) => (
            <a key={id} href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
              {url}
            </a>
          ),
          i + url.length,
        );
        continue;
      }
    } else if (c === '@' && !/[A-Za-z0-9_@/.]/.test(prev)) {
      const match = MENTION.exec(text.slice(i, i + 40));
      if (match) {
        const name = match[1] ?? '';
        const me = !!selfName && name.toLowerCase() === selfName.toLowerCase();
        wrap(
          (id) => (
            <span key={id} className={`mention${me ? ' me' : ''}`}>
              @{name}
            </span>
          ),
          i + match[0].length,
        );
        continue;
      }
    }
    plain += c;
    i += 1;
  }
  flush();
  return out;
}

/** Message text as React nodes; fenced ``` blocks first, everything else inline. */
export function renderMarkdown(content: string, selfName: string | null = null): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = 0;
  let n = 0;
  while (rest < content.length) {
    const open = content.indexOf('```', rest);
    const close = open === -1 ? -1 : content.indexOf('```', open + 3);
    if (close === -1) break;
    if (open > rest) out.push(...inline(content.slice(rest, open), selfName, 0, `t${n}`));
    // "```js\n…": the first line only names the language.
    const body = content.slice(open + 3, close).replace(/^[A-Za-z0-9+#-]*\n/, '');
    out.push(
      <pre key={`b${n}`} className="code-block">
        <code>{body.replace(/\n$/, '')}</code>
      </pre>,
    );
    rest = close + 3;
    // The line break after a block is the block's own.
    if (content[rest] === '\n') rest += 1;
    n += 1;
  }
  out.push(...inline(content.slice(rest), selfName, 0, `t${n}`));
  return out;
}

/** The message names this person outside of code. */
export function mentionsUser(content: string, username: string): boolean {
  const plain = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return new RegExp(`(^|[^A-Za-z0-9_@/.])@${username}($|[^A-Za-z0-9_])`, 'i').test(plain);
}
