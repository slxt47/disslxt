import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../components/Composer';
import { MessageItem } from '../components/MessageItem';
import { VoicePlayer } from '../components/VoicePlayer';
import { formatDuration, pickRecorderMime } from '../speech/useVoiceRecorder';
import { ME, msg } from './fixtures';

class FakeRecorder {
  static last: FakeRecorder | null = null;
  static isTypeSupported = (t: string) => t === 'audio/mp4'; // like Safari
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: { getTracks: () => { stop: () => void }[] },
    opts?: { mimeType?: string },
  ) {
    this.mimeType = opts?.mimeType ?? '';
    FakeRecorder.last = this;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['x'.repeat(2048)], { type: this.mimeType }) });
    this.onstop?.();
  }
}

let trackStopped: ReturnType<typeof vi.fn>;
function fakeMic(result: 'ok' | 'denied' = 'ok') {
  trackStopped = vi.fn();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        if (result === 'denied') throw new DOMException('no', 'NotAllowedError');
        return { getTracks: () => [{ stop: trackStopped }] };
      }),
    },
  });
}

beforeEach(() => {
  FakeRecorder.last = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // @ts-expect-error test cleanup of the faked property
  delete navigator.mediaDevices;
});

describe('recording a voice message', () => {
  it('no record button without MediaRecorder or while text is typed', async () => {
    render(<Composer channelName="g" onSend={vi.fn()} onSendVoice={vi.fn()} />);
    expect(screen.queryByTestId('record-voice')).toBeNull();
  });

  it('records with the best supported format and sends blob + duration', async () => {
    fakeMic();
    const onSendVoice = vi.fn().mockResolvedValue(undefined);
    render(<Composer channelName="g" onSend={vi.fn()} onSendVoice={onSendVoice} />);
    await userEvent.type(screen.getByTestId('composer-input'), 'x');
    expect(screen.queryByTestId('record-voice')).toBeNull(); // text present → send text instead
    await userEvent.clear(screen.getByTestId('composer-input'));

    await userEvent.click(screen.getByTestId('record-voice'));
    expect(await screen.findByTestId('recording-bar')).toBeTruthy();
    expect(FakeRecorder.last!.mimeType).toBe('audio/mp4');
    const constraints = vi.mocked(navigator.mediaDevices.getUserMedia).mock.calls[0]![0];
    expect(constraints).toMatchObject({ audio: { echoCancellation: true, noiseSuppression: true } });

    await userEvent.click(screen.getByTestId('voice-send'));
    expect(onSendVoice).toHaveBeenCalledTimes(1);
    const [blob, duration] = onSendVoice.mock.calls[0]!;
    expect((blob as Blob).type).toBe('audio/mp4');
    expect((blob as Blob).size).toBe(2048);
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(trackStopped).toHaveBeenCalled(); // microphone released
    expect(screen.queryByTestId('recording-bar')).toBeNull();
  });

  it('cancel discards the recording and releases the microphone', async () => {
    fakeMic();
    const onSendVoice = vi.fn();
    render(<Composer channelName="g" onSend={vi.fn()} onSendVoice={onSendVoice} />);
    await userEvent.click(screen.getByTestId('record-voice'));
    await userEvent.click(await screen.findByTestId('voice-cancel'));
    expect(onSendVoice).not.toHaveBeenCalled();
    expect(trackStopped).toHaveBeenCalled();
  });

  it('stops and sends by itself after 2 minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakeMic();
    const onSendVoice = vi.fn().mockResolvedValue(undefined);
    render(<Composer channelName="g" onSend={vi.fn()} onSendVoice={onSendVoice} />);
    await act(async () => screen.getByTestId('record-voice').click());
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(screen.getByTestId('recording-time').textContent).toMatch(/^1:0\d \/ 2:00$/);
    await act(async () => vi.advanceTimersByTime(61_000));
    expect(onSendVoice).toHaveBeenCalledTimes(1);
    expect(onSendVoice.mock.calls[0]![1]).toBeLessThanOrEqual(120_000);
  });

  it('a denied microphone is explained', async () => {
    fakeMic('denied');
    render(<Composer channelName="g" onSend={vi.fn()} onSendVoice={vi.fn()} />);
    await userEvent.click(screen.getByTestId('record-voice'));
    expect((await screen.findByTestId('composer-error')).textContent).toMatch(/Mikrofon-Zugriff/);
    expect(screen.queryByTestId('recording-bar')).toBeNull();
  });

  it('format preference: Opus first, MP4 for Safari', () => {
    expect(pickRecorderMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickRecorderMime((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickRecorderMime(() => false)).toBeUndefined();
    expect(formatDuration(65_400)).toBe('1:05');
  });
});

describe('playing a voice message', () => {
  const audio = { url: '/api/voice-messages/5', durationMs: 42_000, mime: 'audio/mp4' };

  it('shows length, plays and pauses through the audio element', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(true);
    const { container } = render(<VoicePlayer audio={audio} />);
    expect(container.querySelector('audio')!.getAttribute('src')).toBe(audio.url);
    expect(screen.getByTestId('voice-time').textContent).toBe('0:42');
    await userEvent.click(screen.getByTestId('voice-play'));
    expect(play).toHaveBeenCalled();
    expect(screen.getByLabelText('Pause')).toBeTruthy();
  });

  it('voice messages render the player, and the author can delete but not edit them', () => {
    render(
      <ul>
        <MessageItem
          message={msg(5, { author: ME, kind: 'voice', content: '', audio })}
          isOwn
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </ul>,
    );
    expect(screen.getByTestId('voice-player')).toBeTruthy();
    expect(screen.queryByTestId('message-content')).toBeNull();
    expect(screen.queryByTestId('message-edit')).toBeNull();
    expect(screen.getByTestId('message-delete')).toBeTruthy();
  });
});
