import type { FastifyRequest } from 'fastify';

const BROWSERS: [RegExp, string][] = [
  [/\bEdg\//, 'Edge'],
  [/\bOPR\//, 'Opera'],
  [/\bFirefox\//, 'Firefox'],
  [/\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X/, 'Mac'],
  [/Linux/, 'Linux'],
];

/** "Firefox auf Windows": enough to recognise a device, and all that is kept of the header. */
export function describeDevice(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  if (browser && system) return `${browser} auf ${system}`;
  return browser ?? system ?? null;
}

export const deviceName = (req: FastifyRequest): string | null =>
  describeDevice(req.headers['user-agent']);
