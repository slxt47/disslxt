/** Returns a safe in-app redirect target from `?next=` (only same-origin paths). */
export function safeNext(search: string): string {
  const next = new URLSearchParams(search).get('next');
  return safePath(next);
}

/** `path` if it is a same-origin in-app path, otherwise `/`. */
export function safePath(path: string | null | undefined): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return '/';
  return path;
}
