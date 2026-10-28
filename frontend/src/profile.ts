/** The name to show for a person: their display name if they set one, else the username. */
export function nameOf(
  u: { username: string; displayName?: string | null } | null | undefined,
): string {
  if (!u) return '?';
  return u.displayName?.trim() || u.username;
}
