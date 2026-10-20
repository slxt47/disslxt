import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGE_MAX_LEN } from '@chat-mvp/shared';
import { MessageItem } from '../components/MessageItem';
import { ME, msg } from './fixtures';

function renderItem(isOwn: boolean, message = msg(7, isOwn ? { author: ME } : {})) {
  const onEdit = vi.fn<(id: string, content: string) => Promise<void>>().mockResolvedValue();
  const onDelete = vi.fn<(id: string) => Promise<void>>().mockResolvedValue();
  const user = userEvent.setup();
  render(
    <ul>
      <MessageItem message={message} isOwn={isOwn} onEdit={onEdit} onDelete={onDelete} />
    </ul>,
  );
  return { user, onEdit, onDelete };
}

describe('MessageItem', () => {
  it('renders author and content as plain text (no HTML interpretation)', () => {
    const payload = '<b>x</b><img src=x onerror="window.__xss=1">';
    renderItem(false, msg(1, { content: payload }));
    const content = screen.getByTestId('message-content');
    expect(content.textContent).toBe(payload);
    expect(content.querySelector('b')).toBeNull();
    expect(content.querySelector('img')).toBeNull();
    expect(screen.getByTestId('message-author').textContent).toBe('bob');
  });

  it('shows "(bearbeitet)" for edited messages', () => {
    renderItem(false, msg(1, { editedAt: '2026-10-20T12:05:00.000Z' }));
    expect(screen.getByTestId('message-edited').textContent).toBe('(bearbeitet)');
  });

  it('never shows edit/delete controls on other users’ messages', () => {
    renderItem(false);
    expect(screen.queryByTestId('message-edit')).toBeNull();
    expect(screen.queryByTestId('message-delete')).toBeNull();
  });

  it('edits own messages: Enter saves, Shift+Enter adds a newline', async () => {
    const { user, onEdit } = renderItem(true);
    await user.click(screen.getByTestId('message-edit'));
    const input = screen.getByTestId('message-edit-input') as HTMLTextAreaElement;
    await user.clear(input);
    await user.type(input, 'neu{Shift>}{Enter}{/Shift}zwei{Enter}');
    expect(onEdit).toHaveBeenCalledWith('7', 'neu\nzwei');
    await waitFor(() => expect(screen.queryByTestId('message-edit-input')).toBeNull());
  });

  it('D5: an edit with 2000 emoji is saved, 2001 emoji are rejected inline', async () => {
    const { user, onEdit } = renderItem(true);
    await user.click(screen.getByTestId('message-edit'));
    const input = screen.getByTestId('message-edit-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '😀'.repeat(MESSAGE_MAX_LEN + 1) } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId('message-error').textContent).toBe('Nachricht ist zu lang');
    fireEvent.change(input, { target: { value: '😀'.repeat(MESSAGE_MAX_LEN) } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('7', '😀'.repeat(MESSAGE_MAX_LEN));
  });

  it('Escape cancels editing without saving', async () => {
    const { user, onEdit } = renderItem(true);
    await user.click(screen.getByTestId('message-edit'));
    await user.type(screen.getByTestId('message-edit-input'), ' geändert{Escape}');
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('message-edit-input')).toBeNull();
    expect(screen.getByTestId('message-content').textContent).toBe('Nachricht 7');
  });

  it('delete asks for inline confirmation; cancel keeps the message', async () => {
    const { user, onDelete } = renderItem(true);
    await user.click(screen.getByTestId('message-delete'));
    await user.click(screen.getByTestId('message-delete-cancel'));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('message-delete'));
    await user.click(screen.getByTestId('message-delete-confirm'));
    expect(onDelete).toHaveBeenCalledWith('7');
  });

  it('shows an inline error when saving fails', async () => {
    const { user, onEdit } = renderItem(true);
    onEdit.mockRejectedValueOnce(new Error('Nicht erlaubt'));
    await user.click(screen.getByTestId('message-edit'));
    await user.type(screen.getByTestId('message-edit-input'), '!{Enter}');
    expect((await screen.findByTestId('message-error')).textContent).toBe('Nicht erlaubt');
  });
});
