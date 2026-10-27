import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageItem } from '../components/MessageItem';
import { dayLabel, layoutMessages } from '../components/MessageList';
import { ME, OTHER, msg } from './fixtures';

const NOW = new Date('2026-10-27T15:00:00');
const at = (s: string) => new Date(s).toISOString();

describe('layoutMessages', () => {
  it('groups messages of one author that follow each other closely', () => {
    const layout = layoutMessages(
      [
        msg(1, { createdAt: at('2026-10-27T14:00:00') }),
        msg(2, { createdAt: at('2026-10-27T14:03:00') }),
        msg(3, { createdAt: at('2026-10-27T14:20:00') }), // gap too long
        msg(4, { createdAt: at('2026-10-27T14:21:00'), author: ME }), // other author
        msg(5, { createdAt: at('2026-10-27T14:22:00'), author: ME }),
      ],
      NOW,
    );
    expect(layout.map((l) => l.grouped)).toEqual([false, true, false, false, true]);
  });

  it('starts every day with a divider and never groups across days', () => {
    const layout = layoutMessages(
      [
        msg(1, { createdAt: at('2026-10-20T10:00:00') }),
        msg(2, { createdAt: at('2026-10-26T23:58:00') }),
        msg(3, { createdAt: at('2026-10-27T00:01:00') }),
        msg(4, { createdAt: at('2026-10-27T00:02:00') }),
      ],
      NOW,
    );
    expect(layout.map((l) => l.dayLabel)).toEqual([
      'Dienstag, 20. Oktober 2026',
      'Gestern',
      'Heute',
      null,
    ]);
    expect(layout.map((l) => l.grouped)).toEqual([false, false, false, true]);
  });

  it('labels today and yesterday', () => {
    expect(dayLabel(new Date('2026-10-27T08:00:00'), NOW)).toBe('Heute');
    expect(dayLabel(new Date('2026-10-26T08:00:00'), NOW)).toBe('Gestern');
  });
});

describe('MessageItem in a group', () => {
  const props = { isOwn: false, onEdit: vi.fn(), onDelete: vi.fn() };

  it('hides the avatar but keeps the author for screen readers', () => {
    const { container } = render(
      <ul>
        <MessageItem {...props} message={msg(1, { author: OTHER })} grouped />
      </ul>,
    );
    expect(container.querySelector('.avatar')).toBeNull();
    expect(screen.getByTestId('message-author').textContent).toBe('bob');
    expect(container.querySelector('.message-meta')?.classList.contains('sr-only')).toBe(true);
  });

  it('still shows "(bearbeitet)", outside the message text', () => {
    render(
      <ul>
        <MessageItem
          {...props}
          message={msg(1, { editedAt: '2026-10-20T12:05:00.000Z' })}
          grouped
        />
      </ul>,
    );
    expect(screen.getByTestId('message-edited').textContent).toBe('(bearbeitet)');
    expect(screen.getByTestId('message-content').textContent).toBe('Nachricht 1');
  });

  it('renders the day divider inside the message row', () => {
    render(
      <ul>
        <MessageItem {...props} message={msg(1)} dayLabel="Heute" />
      </ul>,
    );
    expect(screen.getByTestId('day-divider').textContent).toBe('Heute');
  });
});
