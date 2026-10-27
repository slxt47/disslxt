import { FILE_NAME_MAX_LEN } from '@disslxt/shared';

/** Image types shown inline. SVG is deliberately missing: it can carry scripts. */
export type InlineImage = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** Recognises images by their bytes; the client's name and type decide nothing. */
export function sniffImage(buf: Buffer): InlineImage | null {
  if (buf.length < 12) return null;
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const head = buf.toString('latin1', 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/**
 * Display/download name: no paths, no control or bidi characters (which could disguise
 * "invoice‮fdp.exe" as a PDF), trimmed to a sane length with the extension kept.
 */
export function sanitizeFileName(raw: string): string {
  let name = raw
    .normalize('NFC')
    .replace(/^.*[\\/]/, '')
    // Control characters are exactly what this strips.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .replace(/^\.+/, '');
  if (!name) name = 'datei';
  const chars = [...name];
  if (chars.length > FILE_NAME_MAX_LEN) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
    name = chars.slice(0, FILE_NAME_MAX_LEN - [...ext].length).join('') + ext;
  }
  return name;
}

/** Content-Disposition with an ASCII fallback and the UTF-8 name (RFC 6266 / 5987). */
export function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
