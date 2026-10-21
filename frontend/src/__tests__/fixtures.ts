import type { MessageDto } from '@disslxt/shared';

export const CHANNEL = '11111111-1111-4111-8111-111111111111';
export const ME = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'alice' };
export const OTHER = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'bob' };

export function msg(id: number | string, overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: String(id),
    channelId: CHANNEL,
    author: OTHER,
    content: `Nachricht ${id}`,
    createdAt: '2026-10-20T12:00:00.000Z',
    editedAt: null,
    ...overrides,
  };
}
