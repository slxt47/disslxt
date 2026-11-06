import type { MessageKind } from '@disslxt/shared';

/** One line for a quote or a list: the text, or what kind of thing it is. */
export function messagePreview(m: { kind: MessageKind; content?: string }): string {
  if (m.kind === 'voice') return '🎤 Sprachnachricht';
  if (m.kind === 'gif') return '🎞️ GIF';
  if (m.kind === 'file') return '📎 Datei';
  if (m.kind === 'poll') return `📊 ${m.content ?? ''}`;
  return m.content ?? '';
}
