import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelDto, WsClientMessage } from '@disslxt/shared';
import { VoiceChannelView } from '../components/VoiceChannelView';
import { useAuthStore } from '../store/auth';
import { resetVoiceStore, useVoiceStore } from '../store/voice';
import { VoiceClient, type VoiceDeps } from '../voice/VoiceClient';
import * as provider from '../voice/VoiceProvider';

const CH = '33333333-3333-4333-8333-333333333333';
const GUILD = '44444444-4444-4444-8444-444444444444';
const peer = (id: string, username: string, muted = false) => ({
  peerId: id,
  userId: `user-${username}`,
  username,
  muted,
});

class FakePC {
  static all: FakePC[] = [];
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  added: unknown[] = [];
  candidates: unknown[] = [];
  closed = false;
  restarted = false;
  onicecandidate: ((ev: { candidate: unknown }) => void) | null = null;
  ontrack: ((ev: { streams: unknown[]; track: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor(public config: RTCConfiguration) {
    FakePC.all.push(this);
  }
  addTrack(track: unknown) {
    this.added.push(track);
  }
  async createOffer(opts?: { iceRestart?: boolean }) {
    return { type: 'offer' as const, sdp: opts?.iceRestart ? 'offer-restart' : 'offer-sdp' };
  }
  async createAnswer() {
    return { type: 'answer' as const, sdp: 'answer-sdp' };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.localDescription = d;
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d;
  }
  async addIceCandidate(c: unknown) {
    this.candidates.push(c);
  }
  restartIce() {
    this.restarted = true;
  }
  /** Simulated WebRTC stats (set per test). */
  static statsFn: (() => RTCStatsReport) | null = null;
  async getStats() {
    return FakePC.statsFn?.() ?? (new Map() as unknown as RTCStatsReport);
  }
  close() {
    this.closed = true;
  }
  /** Test helper: the browser changed the connection state. */
  setState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

function setup(opts: { mic?: 'ok' | 'denied' } = {}) {
  const sent: WsClientMessage[] = [];
  const track = { enabled: true, stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const audios: {
    srcObject: unknown;
    play: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }[] = [];
  const deps: VoiceDeps = {
    send: (m) => {
      sent.push(m);
      return true;
    },
    iceServers: async () => [{ urls: 'turn:turn.example', username: 'u', credential: 'c' }],
    getUserMedia: vi.fn(async () => {
      if (opts.mic === 'denied') throw new DOMException('no', 'NotAllowedError');
      return stream;
    }),
    createPeerConnection: (config) => new FakePC(config) as unknown as RTCPeerConnection,
    createAudio: () => {
      const a = { srcObject: null, play: vi.fn(async () => undefined), remove: vi.fn() };
      audios.push(a);
      return a as unknown as HTMLAudioElement;
    },
  };
  const client = new VoiceClient(deps);
  const signals = () =>
    sent.filter(
      (m): m is Extract<WsClientMessage, { type: 'voice.signal' }> => m.type === 'voice.signal',
    );
  return { client, sent, signals, track, audios, deps };
}

const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  FakePC.all = [];
  resetVoiceStore();
});
afterEach(() => vi.restoreAllMocks());

describe('VoiceClient', () => {
  it('join: asks for the mic (echo cancellation on), then joins; offers to everyone there', async () => {
    const { client, sent, signals, deps } = setup();
    await client.join(CH, GUILD);
    expect(deps.getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    expect(sent).toEqual([{ type: 'voice.join', data: { channelId: CH } }]);
    expect(useVoiceStore.getState()).toMatchObject({ channelId: CH, status: 'joining' });

    client.handle({
      type: 'voice.joined',
      data: {
        channelId: CH,
        peerId: 'self-peer-1',
        peers: [peer('peer-bob-1', 'bob'), peer('peer-cat-1', 'cat')],
      },
    });
    await flush();
    expect(useVoiceStore.getState().status).toBe('connected');
    expect(FakePC.all).toHaveLength(2);
    expect(FakePC.all[0]!.config.iceServers).toEqual([
      { urls: 'turn:turn.example', username: 'u', credential: 'c' },
    ]);
    expect(FakePC.all[0]!.added).toHaveLength(1); // microphone track
    expect(signals().map((s) => [s.data.to, s.data.signal])).toEqual([
      ['peer-bob-1', { type: 'offer', sdp: 'offer-sdp' }],
      ['peer-cat-1', { type: 'offer', sdp: 'offer-sdp' }],
    ]);
  });

  it('answers an offer from someone who joined later; early ICE candidates are queued', async () => {
    const { client, signals } = setup();
    await client.join(CH, GUILD);
    client.handle({
      type: 'voice.joined',
      data: { channelId: CH, peerId: 'self-peer-1', peers: [] },
    });
    client.handle({
      type: 'voice.peer-joined',
      data: { channelId: CH, peer: peer('peer-dan-1', 'dan') },
    });
    const candidate = {
      candidate: 'candidate:1 1 udp 1 10.0.0.2 4000 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };
    client.handle({
      type: 'voice.signal',
      data: { from: 'peer-dan-1', signal: { type: 'offer', sdp: 'their-offer' } },
    });
    await flush();
    const pc = FakePC.all[0]!;
    expect(pc.remoteDescription).toEqual({ type: 'offer', sdp: 'their-offer' });
    expect(signals().at(-1)!.data).toEqual({
      to: 'peer-dan-1',
      signal: { type: 'answer', sdp: 'answer-sdp' },
    });
    client.handle({
      type: 'voice.signal',
      data: { from: 'peer-dan-1', signal: { type: 'candidate', candidate } },
    });
    await flush();
    expect(pc.candidates).toEqual([candidate]);
  });

  it('plays the remote audio and shows connection states', async () => {
    const { client, audios } = setup();
    await client.join(CH, GUILD);
    client.handle({
      type: 'voice.joined',
      data: { channelId: CH, peerId: 'self-peer-1', peers: [peer('peer-bob-1', 'bob')] },
    });
    await flush();
    const remote = { id: 'remote-stream' };
    FakePC.all[0]!.ontrack?.({ streams: [remote], track: {} });
    expect(audios[0]!.srcObject).toBe(remote);
    expect(audios[0]!.play).toHaveBeenCalled();
    act(() => FakePC.all[0]!.setState('connected'));
    expect(useVoiceStore.getState().peers['peer-bob-1']!.connection).toBe('connected');
  });

  it('the offering side restarts ICE when a connection fails (e.g. Wi-Fi → mobile)', async () => {
    const { client, signals } = setup();
    await client.join(CH, GUILD);
    client.handle({
      type: 'voice.joined',
      data: { channelId: CH, peerId: 'self-peer-1', peers: [peer('peer-bob-1', 'bob')] },
    });
    await flush();
    act(() => FakePC.all[0]!.setState('failed'));
    await flush();
    expect(FakePC.all[0]!.restarted).toBe(true);
    expect(signals().at(-1)!.data.signal).toEqual({ type: 'offer', sdp: 'offer-restart' });
  });

  it('peer-left closes that connection and removes its audio', async () => {
    const { client, audios } = setup();
    await client.join(CH, GUILD);
    client.handle({
      type: 'voice.joined',
      data: { channelId: CH, peerId: 'self-peer-1', peers: [peer('peer-bob-1', 'bob')] },
    });
    await flush();
    client.handle({ type: 'voice.peer-left', data: { channelId: CH, peerId: 'peer-bob-1' } });
    expect(FakePC.all[0]!.closed).toBe(true);
    expect(audios[0]!.remove).toHaveBeenCalled();
    expect(useVoiceStore.getState().peers).toEqual({});
  });

  it('mute switches the microphone track off and tells the others', async () => {
    const { client, sent, track } = setup();
    await client.join(CH, GUILD);
    client.handle({
      type: 'voice.joined',
      data: { channelId: CH, peerId: 'self-peer-1', peers: [] },
    });
    client.setMuted(true);
    expect(track.enabled).toBe(false);
    expect(sent.at(-1)).toEqual({ type: 'voice.mute', data: { muted: true } });
    client.setMuted(false);
    expect(track.enabled).toBe(true);
  });

  it('leave stops the microphone, closes everything and tells the server', async () => {
    const { client, sent, track } = setup();
    await client.join(CH, GUILD);
    client.handle({
      type: 'voice.joined',
      data: { channelId: CH, peerId: 'self-peer-1', peers: [peer('peer-bob-1', 'bob')] },
    });
    await flush();
    client.leave();
    expect(sent.at(-1)).toEqual({ type: 'voice.leave' });
    expect(track.stop).toHaveBeenCalled();
    expect(FakePC.all[0]!.closed).toBe(true);
    expect(useVoiceStore.getState()).toMatchObject({
      channelId: null,
      status: 'idle',
      error: null,
    });
  });

  it('a denied microphone does not join and explains why', async () => {
    const { client, sent } = setup({ mic: 'denied' });
    await client.join(CH, GUILD);
    expect(sent).toEqual([]);
    expect(useVoiceStore.getState()).toMatchObject({ status: 'idle', channelId: null });
    expect(useVoiceStore.getState().error).toMatch(/Mikrofon-Zugriff verweigert/);
  });

  it('full channel and "joined on another device" end the session with a message', async () => {
    const { client } = setup();
    await client.join(CH, GUILD);
    client.handle({ type: 'error', data: { code: 'VOICE_FULL', channelId: CH } });
    expect(useVoiceStore.getState()).toMatchObject({
      status: 'idle',
      error: 'Der Sprachkanal ist voll.',
    });

    await client.join(CH, GUILD);
    client.handle({
      type: 'voice.joined',
      data: { channelId: CH, peerId: 'self-peer-1', peers: [] },
    });
    client.handle({ type: 'voice.left', data: { channelId: CH, reason: 'other-device' } });
    expect(useVoiceStore.getState().error).toMatch(/anderen Gerät/);
  });

  it('after a WebSocket reconnect it joins again with the same microphone', async () => {
    const { client, sent, deps } = setup();
    await client.join(CH, GUILD);
    client.handle({
      type: 'voice.joined',
      data: { channelId: CH, peerId: 'self-peer-1', peers: [peer('peer-bob-1', 'bob')] },
    });
    await flush();
    client.rejoinAfterReconnect();
    expect(FakePC.all[0]!.closed).toBe(true);
    expect(sent.at(-1)).toEqual({ type: 'voice.join', data: { channelId: CH } });
    expect(deps.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('switching the microphone mid-call replaces the track on every connection', async () => {
    const { client, track, deps } = setup();
    await client.join(CH, GUILD, { inputId: 'mic-a' });
    expect(vi.mocked(deps.getUserMedia).mock.calls[0]![0]).toMatchObject({
      audio: { deviceId: { ideal: 'mic-a' } },
    });
    client.handle({
      type: 'voice.joined',
      data: { channelId: CH, peerId: 'self-peer-1', peers: [peer('peer-bob-1', 'bob')] },
    });
    await flush();
    const replaceTrack = vi.fn(async () => undefined);
    (FakePC.all[0] as unknown as { getSenders: () => unknown[] }).getSenders = () => [
      { track: { kind: 'audio' }, replaceTrack },
    ];
    const newTrack = { enabled: true, stop: vi.fn(), kind: 'audio' };
    vi.mocked(deps.getUserMedia).mockResolvedValueOnce({
      getTracks: () => [newTrack],
      getAudioTracks: () => [newTrack],
    } as unknown as MediaStream);
    client.setMuted(true);
    await client.setInputDevice('mic-b');
    expect(replaceTrack).toHaveBeenCalledWith(newTrack);
    expect(newTrack.enabled).toBe(false); // stays muted
    expect(track.stop).toHaveBeenCalled(); // old microphone released
  });

  it('the chosen speaker is applied to every participant’s audio', async () => {
    const { client, audios } = setup();
    await client.join(CH, GUILD, { outputId: 'spk-1' });
    client.handle({
      type: 'voice.joined',
      data: { channelId: CH, peerId: 'self-peer-1', peers: [peer('peer-bob-1', 'bob')] },
    });
    await flush();
    expect(audios).toHaveLength(1);
    const setSinkId = vi.fn(async () => undefined);
    (audios[0] as unknown as { setSinkId: typeof setSinkId }).setSinkId = setSinkId;
    await client.setOutputDevice('spk-2');
    expect(setSinkId).toHaveBeenCalledWith('spk-2');
  });

  it('voice.state keeps the participant list of every channel', () => {
    const { client } = setup();
    client.handle({
      type: 'voice.state',
      data: { guildId: GUILD, channelId: CH, peers: [peer('peer-bob-1', 'bob', true)] },
    });
    expect(useVoiceStore.getState().participants[CH]).toEqual([peer('peer-bob-1', 'bob', true)]);
  });
});

describe('VoiceChannelView', () => {
  const channel: ChannelDto = {
    id: CH,
    guildId: GUILD,
    name: 'lounge',
    kind: 'voice',
    createdAt: '',
  };

  it('outside: shows who is there and a join button that joins this channel', async () => {
    const join = vi.fn();
    vi.spyOn(provider, 'useVoice').mockReturnValue({ join } as unknown as VoiceClient);
    vi.spyOn(provider, 'voiceSupported').mockReturnValue(true);
    useAuthStore.setState({ user: { id: 'me', email: 'm@x', username: 'me' } });
    useVoiceStore.setState({ participants: { [CH]: [peer('peer-bob-1', 'bob', true)] } });
    const stop = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })),
        enumerateDevices: vi.fn(async () => [
          { kind: 'audioinput', deviceId: 'mic-usb', label: 'USB-Mikrofon' },
          { kind: 'audiooutput', deviceId: 'spk-1', label: 'Kopfhörer' },
        ]),
      },
    });
    render(
      <MemoryRouter>
        <VoiceChannelView channel={channel} onOpenMenu={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('voice-tile-bob').textContent).toContain('Im Kanal');
    await userEvent.click(screen.getByTestId('voice-join'));
    // The device menu comes first; the microphone list fills once permission is there.
    const select = await screen.findByTestId('voice-input-select');
    expect(await screen.findByText('USB-Mikrofon')).toBeTruthy();
    await userEvent.selectOptions(select, 'mic-usb');
    await userEvent.click(screen.getByTestId('voice-setup-join'));
    expect(join).toHaveBeenCalledWith(CH, GUILD, { inputId: 'mic-usb', outputId: '' });
    expect(stop).toHaveBeenCalled(); // preview microphone released
    // @ts-expect-error test cleanup of the faked property
    delete navigator.mediaDevices;
  });

  it('inside: own tile, mute and leave', async () => {
    const setMuted = vi.fn();
    const leave = vi.fn();
    vi.spyOn(provider, 'useVoice').mockReturnValue({ setMuted, leave } as unknown as VoiceClient);
    vi.spyOn(provider, 'voiceSupported').mockReturnValue(true);
    useAuthStore.setState({ user: { id: 'me', email: 'm@x', username: 'me' } });
    useVoiceStore.setState({
      channelId: CH,
      guildId: GUILD,
      status: 'connected',
      peers: { p: { ...peer('p', 'bob'), connection: 'connected', speaking: true } },
    });
    render(
      <MemoryRouter>
        <VoiceChannelView channel={channel} onOpenMenu={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('voice-tile-me').textContent).toContain('(du)');
    expect(screen.getByTestId('voice-tile-bob').className).toContain('speaking');
    await userEvent.click(screen.getByTestId('voice-mute'));
    expect(setMuted).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByTestId('voice-leave'));
    expect(leave).toHaveBeenCalled();
  });
});

describe('TURN metering', () => {
  /** Minimal RTCStatsReport: Map with forEach/get. */
  const report = (entries: Record<string, unknown>[]) =>
    new Map(entries.map((e) => [e.id as string, e])) as unknown as RTCStatsReport;

  it('relayedBytes counts only the selected pair whose local side is a TURN relay', async () => {
    const { relayedBytes } = await import('../voice/VoiceClient');
    const pc = (stats: RTCStatsReport) =>
      ({ getStats: async () => stats }) as unknown as RTCPeerConnection;
    const relay = report([
      { id: 't', type: 'transport', selectedCandidatePairId: 'p1' },
      {
        id: 'p1',
        type: 'candidate-pair',
        localCandidateId: 'l1',
        bytesSent: 300,
        bytesReceived: 700,
      },
      {
        id: 'p2',
        type: 'candidate-pair',
        localCandidateId: 'l2',
        bytesSent: 9999,
        bytesReceived: 9999,
      },
      { id: 'l1', type: 'local-candidate', candidateType: 'relay' },
      { id: 'l2', type: 'local-candidate', candidateType: 'relay' },
    ]);
    expect([...(await relayedBytes(pc(relay)))]).toEqual([['p1', 1000]]);
    const direct = report([
      { id: 't', type: 'transport', selectedCandidatePairId: 'p1' },
      {
        id: 'p1',
        type: 'candidate-pair',
        localCandidateId: 'l1',
        bytesSent: 300,
        bytesReceived: 700,
      },
      { id: 'l1', type: 'local-candidate', candidateType: 'host' },
    ]);
    expect(await relayedBytes(pc(direct))).toEqual(new Map());
    // Firefox: no transport stats, the pair is flagged itself.
    const firefox = report([
      {
        id: 'p1',
        type: 'candidate-pair',
        selected: true,
        localCandidateId: 'l1',
        bytesSent: 5,
        bytesReceived: 5,
      },
      { id: 'l1', type: 'local-candidate', candidateType: 'relay' },
    ]);
    expect([...(await relayedBytes(pc(firefox)))]).toEqual([['p1', 10]]);
  });

  it('reports only the growth since the last report, also when leaving', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client, deps } = setup();
    const reported: number[] = [];
    deps.reportTurnUsage = (b) => reported.push(b);
    let sent = 1000;
    FakePC.statsFn = () =>
      report([
        { id: 't', type: 'transport', selectedCandidatePairId: 'p1' },
        {
          id: 'p1',
          type: 'candidate-pair',
          localCandidateId: 'l1',
          bytesSent: sent,
          bytesReceived: 0,
        },
        { id: 'l1', type: 'local-candidate', candidateType: 'relay' },
      ]);
    await client.join(CH, GUILD);
    client.handle({
      type: 'voice.joined',
      data: { channelId: CH, peerId: 'self-peer-1', peers: [peer('peer-bob-1', 'bob')] },
    });
    await flush();
    await act(async () => vi.advanceTimersByTime(15_000));
    sent = 4000;
    await act(async () => vi.advanceTimersByTime(15_000));
    sent = 4500;
    client.leave();
    await flush();
    expect(reported).toEqual([1000, 3000, 500]);
    vi.useRealTimers();
    FakePC.statsFn = null;
    expect(FakePC.all[0]!.closed).toBe(true);
  });
});
