/** First web address of a message, outside of code; `<https://…>` means "no preview". */
export function firstUrl(content: string): string | null {
  const plain = content.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  for (const match of plain.matchAll(/(^|[\s(<])(https?:\/\/[^\s<>]+)/gi)) {
    if (match[1] === '<') continue;
    let url = match[2] ?? '';
    while (/[.,;:!?'")]$/.test(url) && !(url.endsWith(')') && url.includes('('))) {
      url = url.slice(0, -1);
    }
    return url;
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? all;
    const hex = code[1]?.toLowerCase() === 'x';
    const n = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
  });
}

const clean = (text: string | undefined, max: number): string | null => {
  const value = text ? decodeEntities(text).replace(/\s+/g, ' ').trim() : '';
  if (!value) return null;
  const chars = [...value];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : value;
};

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match?.[2] ?? match?.[3] ?? match?.[4];
}

export interface PageMeta {
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
}

/** Reads the head of a page with plain text matching: nothing of it is ever executed or shown as HTML. */
export function parseMeta(html: string, pageUrl: string): PageMeta {
  const head = html.slice(0, html.search(/<\/head>/i) >>> 0 || html.length);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attribute(tag, 'property') ?? attribute(tag, 'name'))?.toLowerCase();
    const value = attribute(tag, 'content');
    if (key && value && !meta.has(key)) meta.set(key, value);
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  let imageUrl: string | null = null;
  const image = meta.get('og:image') ?? meta.get('twitter:image');
  if (image) {
    try {
      const url = new URL(decodeEntities(image), pageUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') imageUrl = url.href;
    } catch {
      imageUrl = null;
    }
  }
  return {
    title: clean(meta.get('og:title') ?? meta.get('twitter:title') ?? title, 200),
    description: clean(
      meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'),
      300,
    ),
    siteName: clean(meta.get('og:site_name'), 80),
    imageUrl,
  };
}
