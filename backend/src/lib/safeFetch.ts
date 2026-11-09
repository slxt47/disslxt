import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

/**
 * Fetching addresses that users typed, without letting them reach anything internal (SSRF). Every
 * address a name resolves to is checked at connection time, so a name cannot pass the check and
 * then point somewhere else, and every redirect goes through the same door.
 */
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5000;
const USER_AGENT = 'disslxtbot/1.0 (link preview)';

function ipv4ToNumber(ip: string): number {
  return ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
}

const inRange = (ip: number, base: string, bits: number): boolean => {
  const size = 2 ** (32 - bits);
  const start = ipv4ToNumber(base);
  return ip >= start && ip < start + size;
};

const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // also Docker's networks
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
];

function expandV6(ip: string): number[] | null {
  const zone = ip.split('%')[0] ?? '';
  // "::ffff:1.2.3.4": the dotted end stands for two groups.
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(zone);
  const text = tail
    ? `${tail[1]}${((ipv4ToNumber(tail[2]!) >>> 16) & 0xffff).toString(16)}:${(ipv4ToNumber(tail[2]!) & 0xffff).toString(16)}`
    : zone;
  const [head = '', rest] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (rest === undefined && missing !== 0) return null;
  const groups = [...left, ...Array<string>(Math.max(0, missing)).fill('0'), ...right];
  return groups.length === 8 ? groups.map((g) => parseInt(g, 16)) : null;
}

/** True only for addresses on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip.split('%')[0] ?? '');
  if (family === 4) {
    const n = ipv4ToNumber(ip);
    return !BLOCKED_V4.some(([base, bits]) => inRange(n, base, bits));
  }
  if (family !== 6) return false;
  const g = expandV6(ip);
  if (!g) return false;
  const [a = 0, b = 0, , , , f = 0, h7 = 0, h8 = 0] = g;
  const zeroToFive = g.slice(0, 5).every((x) => x === 0);
  // ::ffff:a.b.c.d and the old ::a.b.c.d carry an IPv4 address.
  if (zeroToFive && (f === 0xffff || f === 0)) {
    if (f === 0 && h7 === 0) return false; // :: and ::1
    return isPublicAddress(`${h7 >> 8}.${h7 & 255}.${h8 >> 8}.${h8 & 255}`);
  }
  if (a === 0x64 && b === 0xff9b) return false; // NAT64
  if (a === 0x2002) return false; // 6to4 can wrap anything
  if (a === 0x2001 && b === 0xdb8) return false; // documentation
  if (a === 0x2001 && b === 0) return false; // Teredo
  if ((a & 0xfe00) === 0xfc00) return false; // unique local
  if ((a & 0xffc0) === 0xfe80) return false; // link-local
  if ((a & 0xff00) === 0xff00) return false; // multicast
  return (a & 0xe000) === 0x2000; // only global unicast is left
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** Refuses a name as soon as ANY of its addresses is internal. */
function checkedLookup(host: string, options: object, done: LookupCallback): void {
  dnsLookup(host, { all: true }, (err, addresses) => {
    if (err) return done(err, '');
    if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
      return done(new Error('address not allowed'), '');
    }
    if ((options as { all?: boolean }).all) return done(null, addresses);
    const first = addresses[0]!;
    done(null, first.address, first.family);
  });
}

/** Only plain web addresses: no other schemes or ports, no credentials, no internal IPs. */
export function allowedUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) return null;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
  return url;
}

export interface FetchedPage {
  url: string;
  contentType: string;
  body: Buffer;
}

function getOnce(url: URL): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        lookup: checkedLookup as never,
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,image/*;q=0.8',
          'Accept-Language': 'de,en;q=0.8',
        },
      },
      resolve,
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end();
  });
}

function readBody(res: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => res.destroy(new Error('timeout')), TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    };
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      chunks.push(chunk);
      // A page's head is at the start: the rest is not needed.
      if (size >= maxBytes) {
        res.destroy();
        finish();
      }
    });
    res.on('end', finish);
    res.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** GET with every safeguard; null for anything refused, failed or not 200. */
export async function safeGet(raw: string, maxBytes: number): Promise<FetchedPage | null> {
  let url = allowedUrl(raw);
  for (let hop = 0; url && hop <= MAX_REDIRECTS; hop += 1) {
    let res: IncomingMessage;
    try {
      res = await getOnce(url);
    } catch {
      return null;
    }
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy();
      try {
        url = allowedUrl(new URL(res.headers.location, url).href);
      } catch {
        return null;
      }
      continue;
    }
    if (status !== 200) {
      res.destroy();
      return null;
    }
    try {
      return {
        url: url.href,
        contentType: String(res.headers['content-type'] ?? '').toLowerCase(),
        body: await readBody(res, maxBytes),
      };
    } catch {
      return null;
    }
  }
  return null;
}
