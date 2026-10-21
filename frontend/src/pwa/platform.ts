/** Platform checks for install/push hints. Everything reads from the passed objects so tests can
 *  fake them. */
export interface PlatformEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** navigator.standalone (iOS only). */
  standalone?: boolean;
  matchMedia?: (q: string) => { matches: boolean };
}

function env(): PlatformEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone,
    matchMedia: typeof window.matchMedia === 'function' ? (q) => window.matchMedia(q) : undefined,
  };
}

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac with a touch screen). */
export function isIos(e: PlatformEnv = env()): boolean {
  return (
    /iPhone|iPad|iPod/.test(e.userAgent) || (/Macintosh/.test(e.userAgent) && e.maxTouchPoints > 1)
  );
}

/** Started from the home screen / as an installed app (no browser chrome). */
export function isStandalone(e: PlatformEnv = env()): boolean {
  return e.standalone === true || !!e.matchMedia?.('(display-mode: standalone)').matches;
}

/** iOS major version from the user agent ("OS 16_4" / "Version/16.4"), or null. */
export function iosVersion(e: PlatformEnv = env()): number | null {
  const m = /OS (\d+)_\d+/.exec(e.userAgent) ?? /Version\/(\d+)\./.exec(e.userAgent);
  return m?.[1] ? Number(m[1]) : null;
}

/**
 * On iOS, Web Push only exists for web apps added to the home screen (iOS 16.4+). In Safari
 * itself the PushManager is missing, so the app has to explain "add to home screen" first.
 */
export function needsHomeScreenForPush(e: PlatformEnv = env()): boolean {
  return isIos(e) && !isStandalone(e);
}
