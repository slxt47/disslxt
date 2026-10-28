import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILE_MAX_BYTES } from '@disslxt/shared';
import { api } from '../api/endpoints';
import { Composer } from '../components/Composer';
import { FileAttachment, formatBytes } from '../components/FileAttachment';
import { UploadQueue, useUploads } from '../components/UploadQueue';
import { spokenText } from '../speech/tts';
import { CHANNEL, msg } from './fixtures';

afterEach(() => vi.restoreAllMocks());

describe('sharing files', () => {
  it('the paperclip picks files; pasting a screenshot shares it too', async () => {
    const onAttachFiles = vi.fn();
    render(<Composer channelName="g" onSend={vi.fn()} onAttachFiles={onAttachFiles} />);
    const file = new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByTestId('file-input'), file);
    expect(onAttachFiles).toHaveBeenCalledWith([file]);

    const shot = new File(['png'], 'image.png', { type: 'image/png' });
    const input = screen.getByTestId('composer-input');
    act(() => {
      input.dispatchEvent(
        Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
          clipboardData: { files: [shot] },
        }),
      );
    });
    expect(onAttachFiles).toHaveBeenLastCalledWith([shot]);
  });

  it('uploads with progress, then the message appears; too big files never upload', async () => {
    let progress!: (f: number) => void;
    let finish!: () => void;
    const send = vi.spyOn(api, 'sendFile').mockImplementation((_c, _f, onProgress) => {
      progress = onProgress;
      return new Promise((resolve) => {
        finish = () => resolve({ message: msg(9, { kind: 'file', content: '' }) });
      });
    });
    const { result } = renderHook(() => useUploads(CHANNEL));
    const big = new File(['x'], 'riesig.zip');
    Object.defineProperty(big, 'size', { value: FILE_MAX_BYTES + 1 });
    act(() => result.current.start([new File(['abc'], 'a.txt'), big]));
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.uploads.map((u) => [u.name, u.error])).toEqual([
      ['a.txt', null],
      ['riesig.zip', 'Zu groß (max. 25 MB)'],
    ]);
    act(() => progress(0.5));
    expect(result.current.uploads[0]!.progress).toBe(0.5);
    await act(async () => finish());
    expect(result.current.uploads.map((u) => u.name)).toEqual(['riesig.zip']);

    render(<UploadQueue uploads={result.current.uploads} onRemove={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Zu groß/);
  });

  it('images render as a preview, other files as a download card', () => {
    const { rerender } = render(
      <FileAttachment
        file={{ url: '/api/files/1', name: 'strand.jpg', size: 2048, isImage: true }}
      />,
    );
    expect(screen.getByTestId('file-image').querySelector('img')!.getAttribute('src')).toBe(
      '/api/files/1',
    );
    rerender(
      <FileAttachment
        file={{ url: '/api/files/2', name: 'Bericht.pdf', size: 3_400_000, isImage: false }}
      />,
    );
    const card = screen.getByTestId('file-card');
    expect(card.getAttribute('download')).toBe('Bericht.pdf');
    expect(card.textContent).toContain('3,2 MB');
    expect(card.textContent).toContain('PDF');
  });

  it('formatting and read-aloud text', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(20_480)).toBe('20 KB');
    expect(
      spokenText({
        author: { id: 'x', username: 'bob', displayName: null, avatarUrl: null },
        content: '',
        kind: 'file',
        file: { name: 'a.png', isImage: true },
      }),
    ).toBe('bob hat ein Bild geschickt: a.png');
  });
});
