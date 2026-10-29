import type { DmChannelDto } from '@disslxt/shared';

/** The name to show for a person: their display name if they set one, else the username. */
export function nameOf(
  u: { username: string; displayName?: string | null } | null | undefined,
): string {
  if (!u) return '?';
  return u.displayName?.trim() || u.username;
}

/** Title of a private conversation: the friend's name, or the group's name / its members. */
export function conversationName(dm: DmChannelDto): string {
  if (dm.channel.kind !== 'group') return nameOf(dm.peer);
  if (dm.channel.name.trim()) return dm.channel.name;
  if (dm.members.length === 0) return 'Nur du';
  const names = dm.members.map(nameOf);
  return names.length > 3
    ? `${names.slice(0, 3).join(', ')} +${names.length - 3}`
    : names.join(', ');
}
