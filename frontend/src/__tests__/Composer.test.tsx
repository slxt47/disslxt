import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGE_MAX_LEN } from '@chat-mvp/shared';
import { ApiRequestError } from '../api/client';
import { Composer } from '../components/Composer';

function setup(onSend = vi.fn<(content: string) => Promise<void>>().mockResolvedValue()) {
  const user = userEvent.setup();
  render(<Composer channelName="general" onSend={onSend} />);
  const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
  return { user, input, onSend };
}

describe('Composer', () => {
  it('sends the trimmed text on Enter and clears the field', async () => {
    const { user, input, onSend } = setup();
    await user.type(input, '  Hallo Welt  {Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Hallo Welt');
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('inserts a newline on Shift+Enter without sending', async () => {
    const { user, input, onSend } = setup();
    await user.type(input, 'Zeile 1{Shift>}{Enter}{/Shift}Zeile 2');
    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe('Zeile 1\nZeile 2');
    await user.type(input, '{Enter}');
    expect(onSend).toHaveBeenCalledWith('Zeile 1\nZeile 2');
  });

  it('does not send empty or whitespace-only input', async () => {
    const { user, input, onSend } = setup();
    await user.type(input, '   {Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByTestId('composer-send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not send while an IME composition is active', () => {
    const { input, onSend } = setup();
    fireEvent.change(input, { target: { value: 'にほん' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends via the button', async () => {
    const { user, input, onSend } = setup();
    await user.type(input, 'per Klick');
    await user.click(screen.getByTestId('composer-send'));
    expect(onSend).toHaveBeenCalledWith('per Klick');
  });

  it('disables the field while sending', async () => {
    let resolve!: () => void;
    const onSend = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const { user, input } = setup(onSend);
    await user.type(input, 'langsam{Enter}');
    expect(input.disabled).toBe(true);
    resolve();
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(input.value).toBe('');
  });

  it('shows a counter and blocks sending above the limit', async () => {
    const { input, onSend } = setup();
    fireEvent.change(input, { target: { value: 'x'.repeat(MESSAGE_MAX_LEN + 1) } });
    expect(screen.getByTestId('composer-counter').textContent).toContain(
      `${MESSAGE_MAX_LEN + 1}/${MESSAGE_MAX_LEN}`,
    );
    expect((screen.getByTestId('composer-send') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows a friendly message on 429 and keeps the text', async () => {
    const onSend = vi
      .fn<(content: string) => Promise<void>>()
      .mockRejectedValue(new ApiRequestError(429, 'RATE_LIMITED', 'Zu viele Anfragen'));
    const { user, input } = setup(onSend);
    await user.type(input, 'spam{Enter}');
    expect((await screen.findByTestId('composer-error')).textContent).toBe(
      'Zu viele Nachrichten, bitte kurz warten',
    );
    expect(input.value).toBe('spam');
  });
});
