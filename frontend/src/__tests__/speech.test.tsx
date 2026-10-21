import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../components/Composer';
import { MessageItem } from '../components/MessageItem';
import { SpeechSettings } from '../components/SpeechSettings';
import { activeView, autoRead } from '../realtime/RealtimeProvider';
import { transcriptOf, type RecognitionEventLike, type RecognitionLike } from '../speech/dictation';
import { pickGermanVoice } from '../speech/tts';
import { usePrefs } from '../store/prefs';
import { CHANNEL, ME, OTHER, msg } from './fixtures';

// ---------------------------------------------------------------------------------------------
// Fakes for the Web Speech API

class FakeRecognition implements RecognitionLike {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;
  started = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
  /** Emits results: [text, isFinal][] */
  emit(results: [string, boolean][]) {
    const ev: RecognitionEventLike = {
      resultIndex: 0,
      results: results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })),
    };
    this.onresult?.(ev);
  }
}

class FakeUtterance {
  lang = '';
  rate = 1;
  voice: unknown = null;
  constructor(public text: string) {}
}

function fakeSynth() {
  const synth = {
    spoken: [] as FakeUtterance[],
    cancel: vi.fn(),
    speak: vi.fn((u: FakeUtterance) => synth.spoken.push(u)),
    getVoices: () => [] as SpeechSynthesisVoice[],
  };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return synth;
}

beforeEach(() => {
  usePrefs.getState().set({ autoRead: false, speechRate: 1 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeRecognition.last = null;
  activeView.channelId = null;
});

// ---------------------------------------------------------------------------------------------

describe('dictation', () => {
  it('transcriptOf separates final and interim text', () => {
    const ev = {
      resultIndex: 0,
      results: [
        Object.assign([{ transcript: 'Hallo ' }], { isFinal: true }),
        Object.assign([{ transcript: 'zusam' }], { isFinal: false }),
      ],
    };
    expect(transcriptOf(ev)).toEqual({ final: 'Hallo', interim: 'zusam' });
  });

  it('no microphone button where the browser has no speech recognition (e.g. Firefox)', () => {
    render(<Composer channelName="general" onSend={vi.fn()} />);
    expect(screen.queryByTestId('dictate-button')).toBeNull();
  });

  it('dictates German into the field after the typed text; interim results are replaced', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<Composer channelName="general" onSend={onSend} />);
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
    await userEvent.type(input, 'Notiz:');

    const button = screen.getByTestId('dictate-button');
    await userEvent.click(button);
    const rec = FakeRecognition.last!;
    expect(rec.started).toBe(true);
    expect(rec.lang).toBe('de-DE');
    expect(rec.interimResults).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(input.placeholder).toBe('Sprich jetzt…');

    act(() => rec.emit([['Treffen um', false]]));
    expect(input.value).toBe('Notiz: Treffen um');
    act(() => rec.emit([['Treffen um acht', true]]));
    expect(input.value).toBe('Notiz: Treffen um acht');

    await userEvent.click(button); // stop
    expect(button.getAttribute('aria-pressed')).toBe('false');
    // Nothing is sent automatically: the text can still be corrected.
    expect(onSend).not.toHaveBeenCalled();
  });

  it('a denied microphone shows a helpful error', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    render(<Composer channelName="general" onSend={vi.fn()} />);
    await userEvent.click(screen.getByTestId('dictate-button'));
    act(() => FakeRecognition.last!.onerror?.({ error: 'not-allowed' }));
    expect(screen.getByTestId('composer-error').textContent).toMatch(/Mikrofon-Zugriff verweigert/);
  });
});

describe('read aloud', () => {
  it('prefers a local German voice', () => {
    const v = (lang: string, localService: boolean, name = lang) =>
      ({ lang, localService, name }) as SpeechSynthesisVoice;
    expect(
      pickGermanVoice([v('en-US', true), v('de-DE', false, 'net'), v('de-DE', true, 'local')])
        ?.name,
    ).toBe('local');
    expect(pickGermanVoice([v('de-AT', false)])?.lang).toBe('de-AT');
    expect(pickGermanVoice([v('en-US', true)])).toBeNull();
  });

  it('every message (not only own ones) has a "Vorlesen" button that interrupts and speaks', async () => {
    const synth = fakeSynth();
    render(
      <ul>
        <MessageItem
          message={msg(3, { content: 'Hallo zusammen' })}
          isOwn={false}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </ul>,
    );
    await userEvent.click(screen.getByTestId('message-speak'));
    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.spoken.map((u) => [u.text, u.lang])).toEqual([['bob: Hallo zusammen', 'de-DE']]);
    expect(screen.queryByTestId('message-edit')).toBeNull();
  });

  it('auto-read speaks new messages of others in the open channel only, when switched on', () => {
    const synth = fakeSynth();
    activeView.channelId = CHANNEL;
    const created = (author: typeof ME, channelId = CHANNEL) =>
      ({ type: 'message.created', data: { message: msg(9, { author, channelId }) } }) as const;

    autoRead(created(OTHER), ME.id);
    expect(synth.spoken).toEqual([]); // off by default

    usePrefs.getState().set({ autoRead: true, speechRate: 1.3 });
    autoRead(created(ME), ME.id); // own message
    autoRead(created(OTHER, '22222222-2222-4222-8222-222222222222'), ME.id); // other channel
    autoRead(created(OTHER), ME.id);
    expect(synth.spoken.map((u) => [u.text, u.rate])).toEqual([['bob: Nachricht 9', 1.3]]);
    expect(synth.cancel).not.toHaveBeenCalled(); // queues, does not cut off
  });

  it('switching auto-read on speaks a confirmation in the click (iOS unlock) and persists', async () => {
    const synth = fakeSynth();
    render(<SpeechSettings />);
    await userEvent.click(screen.getByTestId('auto-read-toggle'));
    expect(usePrefs.getState().autoRead).toBe(true);
    expect(synth.spoken.at(-1)?.text).toBe('Vorlesen ist an.');
    expect(JSON.parse(localStorage.getItem('disslxt:prefs')!).autoRead).toBe(true);
    await userEvent.click(screen.getByTestId('auto-read-toggle'));
    expect(usePrefs.getState().autoRead).toBe(false);
  });

  it('without speechSynthesis the settings say so', () => {
    render(<SpeechSettings />);
    expect(screen.getByText('Dieser Browser kann nicht vorlesen.')).toBeTruthy();
  });
});
