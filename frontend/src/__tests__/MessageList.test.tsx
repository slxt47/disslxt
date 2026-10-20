import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageDto } from '@chat-mvp/shared';
import { MessageList, type MessageListProps } from '../components/MessageList';
import { CHANNEL, ME, msg } from './fixtures';

const ROW = 40;
const VIEWPORT = 400;

/**
 * jsdom has no layout: emulate a scroll container whose content height is rows × 40 px and whose
 * scrollTop is clamped like in a browser.
 */
function emulateLayout(el: HTMLElement) {
  let top = 0;
  const height = () => el.querySelectorAll('li').length * ROW + 50;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: height });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => VIEWPORT });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, height() - VIEWPORT));
    },
  });
}

const range = (from: number, to: number): MessageDto[] =>
  Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));

function setup(initial: MessageDto[], extra: Partial<MessageListProps> = {}) {
  const props: MessageListProps = {
    channelId: CHANNEL,
    messages: [],
    hasMore: false,
    currentUserId: ME.id,
    onLoadOlder: vi.fn().mockResolvedValue(undefined),
    onEdit: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };
  const view = render(<MessageList {...props} />);
  const list = screen.getByTestId('message-list');
  emulateLayout(list);
  view.rerender(<MessageList {...props} messages={initial} />);
  const rerender = (p: Partial<MessageListProps>) =>
    view.rerender(<MessageList {...props} {...p} />);
  const bottomGap = () => list.scrollHeight - list.scrollTop - list.clientHeight;
  return { list, rerender, bottomGap, props };
}

describe('MessageList', () => {
  it('scrolls to the bottom when the channel opens', () => {
    const { bottomGap } = setup(range(1, 30));
    expect(bottomGap()).toBe(0);
  });

  it('auto-scrolls on a new message when the user is near the bottom', () => {
    const { list, rerender, bottomGap } = setup(range(1, 30));
    list.scrollTop = list.scrollTop - 100; // still within 120 px
    fireEvent.scroll(list);
    rerender({ messages: range(1, 31) });
    expect(bottomGap()).toBe(0);
    expect(screen.queryByTestId('new-messages-pill')).toBeNull();
  });

  it('shows the "Neue Nachrichten" pill instead of scrolling when scrolled up', () => {
    const { list, rerender, bottomGap } = setup(range(1, 30));
    list.scrollTop = 0;
    fireEvent.scroll(list);
    rerender({ messages: range(1, 31) });
    expect(list.scrollTop).toBe(0);
    expect(bottomGap()).toBeGreaterThan(120);
    const pill = screen.getByTestId('new-messages-pill');
    fireEvent.click(pill);
    expect(bottomGap()).toBe(0);
    expect(screen.queryByTestId('new-messages-pill')).toBeNull();
  });

  it('always scrolls for the user’s own new message', () => {
    const { list, rerender, bottomGap } = setup(range(1, 30));
    list.scrollTop = 0;
    fireEvent.scroll(list);
    rerender({ messages: [...range(1, 30), msg(31, { author: ME })] });
    expect(bottomGap()).toBe(0);
  });

  it('shows "Ältere laden" only when hasMore', () => {
    const { rerender } = setup(range(1, 5));
    expect(screen.queryByTestId('load-older')).toBeNull();
    rerender({ messages: range(1, 5), hasMore: true });
    expect(screen.getByTestId('load-older').textContent).toBe('Ältere laden');
  });

  it('keeps the scroll position when older messages are prepended', async () => {
    let resolveLoad!: () => void;
    const onLoadOlder = vi.fn(() => new Promise<void>((r) => (resolveLoad = r)));
    const { list, rerender } = setup(range(51, 100), { hasMore: true, onLoadOlder });
    list.scrollTop = 200;
    fireEvent.scroll(list);
    const anchor = screen.getByTestId('message-60');
    const anchorOffset = () =>
      Array.from(list.querySelectorAll('li')).indexOf(anchor as HTMLLIElement) * ROW -
      list.scrollTop;
    const before = anchorOffset();

    fireEvent.click(screen.getByTestId('load-older'));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    rerender({ messages: range(1, 100), hasMore: false });
    await act(async () => resolveLoad());

    expect(list.scrollTop).toBe(200 + 50 * ROW);
    expect(anchorOffset()).toBe(before);
    expect(screen.queryByTestId('load-older')).toBeNull();
  });
});
