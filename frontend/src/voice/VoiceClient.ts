import type { VoicePeerDto, VoiceSignal, WsClientMessage, WsServerMessage } from '@disslxt/shared';
import { patchPeer, useVoiceStore } from '../store/voice';
import { audioConstraints } from './devices';

type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

/** Browser APIs the client needs; injectable so the logic can be tested without WebRTC. */
export interface VoiceDeps {
  send: (msg: WsClientMessage) => boolean;
  iceServers: () => Promise<RTCIceServer[]>;
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  createPeerConnection: (config: RTCConfiguration) => RTCPeerConnection;
  /** Creates (and attaches) the element that plays one remote participant. */
  createAudio: () => HTMLAudioElement;
  /** Optional: speaking indicator. Missing in tests / old browsers. */
  createAudioContext?: () => AudioContext;
  /** Optional: receives bytes relayed through TURN since the last call (monthly quota). */
  reportTurnUsage?: (bytes: number) => void;
}

/** How often relayed traffic is measured and reported while in a call. */
export const TURN_METER_INTERVAL_MS = 15_000;

/**
 * Bytes sent + received over the selected candidate pair(s) of a connection whose local side is a
 * TURN relay, keyed by pair id (the counters restart when another pair gets selected).
 */
export async function relayedBytes(pc: RTCPeerConnection): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const stats = await pc.getStats();
  const selected = new Set<string>();
  stats.forEach((s: { type: string; selectedCandidatePairId?: string }) => {
    if (s.type === 'transport' && s.selectedCandidatePairId)
      selected.add(s.selectedCandidatePairId);
  });
  stats.forEach(
    (s: {
      type: string;
      id: string;
      nominated?: boolean;
      selected?: boolean;
      state?: string;
      localCandidateId?: string;
      bytesSent?: number;
      bytesReceived?: number;
    }) => {
      if (s.type !== 'candidate-pair') return;
      // Chrome/Safari name the pair in the transport stats; Firefox flags it on the pair.
      const inUse =
        selected.size > 0
          ? selected.has(s.id)
          : s.selected === true || (s.nominated && s.state === 'succeeded');
      if (!inUse || !s.localCandidateId) return;
      const local = stats.get(s.localCandidateId) as { candidateType?: string } | undefined;
      if (local?.candidateType !== 'relay') return;
      out.set(s.id, (s.bytesSent ?? 0) + (s.bytesReceived ?? 0));
    },
  );
  return out;
}

const CAMERA_ERRORS: Record<string, string> = {
  NotAllowedError: 'Kamera-Zugriff verweigert. Erlaube ihn in den Einstellungen deines Browsers.',
  NotFoundError: 'Keine Kamera gefunden.',
  NotReadableError: 'Die Kamera wird gerade von einer anderen App benutzt.',
};

/** Camera picture: modest resolution and bitrate, because every participant sends to everyone. */
const CAMERA: MediaTrackConstraints = {
  facingMode: 'user',
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 24, max: 30 },
};
const VIDEO_MAX_BITRATE = 600_000;

const MIC_ERRORS: Record<string, string> = {
  NotAllowedError: 'Mikrofon-Zugriff verweigert. Erlaube ihn in den Einstellungen deines Browsers.',
  NotFoundError: 'Kein Mikrofon gefunden.',
  NotReadableError: 'Das Mikrofon wird gerade von einer anderen App benutzt.',
};

/** RMS level above which someone counts as speaking (0..1). */
const SPEAKING_LEVEL = 0.04;

interface Link {
  peerId: string;
  pc: RTCPeerConnection;
  /** We sent the offer (we joined after them) and therefore restart ICE on failure. */
  initiator: boolean;
  /** ICE candidates that arrived before the remote description. */
  pending: RTCIceCandidateInit[];
  audio: HTMLAudioElement;
  /** Carries the camera picture; exists from the first negotiation on, with or without camera. */
  video?: RTCRtpTransceiver;
  /** Everything received from this participant (audio and video). */
  remote?: MediaStream;
  analyser?: AnalyserNode;
  /** Relayed bytes already reported, per candidate pair. */
  reported: Map<string, number>;
}

/**
 * Live voice over a WebRTC mesh. The server only relays signalling over the existing WebSocket;
 * audio flows directly between browsers (or through TURN). Whoever joins sends the offers to the
 * participants already there, so two peers never offer to each other at the same time.
 */
export class VoiceClient {
  private local: MediaStream | null = null;
  private camera: MediaStreamTrack | null = null;
  private links = new Map<string, Link>();
  private iceServers: RTCIceServer[] = [];
  private audioContext: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  /** Speaker chosen in the device menu ('' = system default). */
  private outputId = '';

  constructor(private readonly deps: VoiceDeps) {}

  /**
   * Joins a voice channel or the call of a private conversation (guildId null). Must run from a
   * click: microphone, camera and audio playback need it (iOS).
   */
  async join(
    channelId: string,
    guildId: string | null,
    devices: { inputId?: string; outputId?: string } = {},
    opts: { video?: boolean } = {},
  ): Promise<void> {
    this.outputId = devices.outputId ?? '';
    const state = useVoiceStore.getState();
    if (state.channelId === channelId && state.status !== 'idle') return;
    if (state.channelId) this.leave();
    useVoiceStore.setState({ channelId, guildId, status: 'joining', error: null, peers: {} });
    // Created synchronously inside the gesture, otherwise iOS keeps it suspended.
    this.startLevels();
    try {
      [this.local, this.iceServers] = await Promise.all([
        this.deps.getUserMedia({ audio: audioConstraints(devices.inputId ?? ''), video: false }),
        this.deps.iceServers().catch(() => [{ urls: 'stun:stun.cloudflare.com:3478' }]),
      ]);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      this.teardown(MIC_ERRORS[name] ?? 'Mikrofon nicht verfügbar.');
      return;
    }
    if (useVoiceStore.getState().channelId !== channelId) {
      // Left again while the permission prompt was open.
      this.local.getTracks().forEach((t) => t.stop());
      this.local = null;
      return;
    }
    this.applyMute(useVoiceStore.getState().muted);
    this.watchLocal();
    if (opts.video) await this.startCamera().catch((err: unknown) => this.cameraFailed(err));
    if (!this.deps.send({ type: 'voice.join', data: { channelId, video: !!this.camera } })) {
      this.teardown('Keine Verbindung zum Server.');
    }
  }

  leave(): void {
    if (!useVoiceStore.getState().channelId) return;
    this.deps.send({ type: 'voice.leave' });
    this.teardown(null);
  }

  setMuted(muted: boolean): void {
    useVoiceStore.setState({ muted });
    this.applyMute(muted);
    if (useVoiceStore.getState().status === 'connected') {
      this.deps.send({ type: 'voice.mute', data: { muted } });
    }
  }

  /** Camera on or off mid-call: the picture is swapped into every connection, no renegotiation. */
  async setVideo(on: boolean): Promise<void> {
    if (on === !!this.camera) return;
    if (on) {
      try {
        await this.startCamera();
      } catch (err) {
        this.cameraFailed(err);
        return;
      }
    } else {
      this.stopCamera();
    }
    await Promise.all([...this.links.values()].map((l) => this.sendCamera(l)));
    if (useVoiceStore.getState().status === 'connected') {
      this.deps.send({ type: 'voice.video', data: { video: on } });
    }
  }

  private async startCamera(): Promise<void> {
    const stream = await this.deps.getUserMedia({ audio: false, video: CAMERA });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new DOMException('no camera', 'NotFoundError');
    this.camera = track;
    useVoiceStore.setState({ video: true, localVideo: stream, error: null });
  }

  private stopCamera(): void {
    this.camera?.stop();
    this.camera = null;
    useVoiceStore.setState({ video: false, localVideo: null });
  }

  private cameraFailed(err: unknown): void {
    const name = err instanceof DOMException ? err.name : '';
    useVoiceStore.setState({ error: CAMERA_ERRORS[name] ?? 'Kamera nicht verfügbar.' });
  }

  /** Puts the current camera picture (or nothing) on a connection's video sender. */
  private async sendCamera(link: Link): Promise<void> {
    const sender = link.video?.sender;
    if (!sender) return;
    try {
      await sender.replaceTrack(this.camera);
      if (!this.camera || !sender.getParameters) return;
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0]!.maxBitrate = VIDEO_MAX_BITRATE;
      await sender.setParameters(params);
    } catch {
      // Older browsers: the picture still goes out, just without the bitrate cap.
    }
  }

  /** Plays everyone through another speaker/headset (where the browser allows choosing). */
  async setOutputDevice(outputId: string): Promise<void> {
    this.outputId = outputId;
    await Promise.all(
      [...this.links.values()].map((l) =>
        (l.audio as SinkAudio).setSinkId?.(outputId).catch(() => undefined),
      ),
    );
  }

  /** Switches the microphone mid-call: the new track replaces the old one on every connection. */
  async setInputDevice(inputId: string): Promise<void> {
    if (!this.local) return;
    const next = await this.deps.getUserMedia({ audio: audioConstraints(inputId), video: false });
    const track = next.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !useVoiceStore.getState().muted;
    await Promise.all(
      [...this.links.values()].map((l) =>
        l.pc
          .getSenders()
          .find((s) => s.track?.kind === 'audio')
          ?.replaceTrack(track),
      ),
    );
    this.local.getTracks().forEach((t) => t.stop());
    this.local = next;
    this.watchLocal();
  }

  /** The WebSocket came back: the server forgot us, so join again with the same microphone. */
  rejoinAfterReconnect(): void {
    const { channelId } = useVoiceStore.getState();
    if (!channelId || !this.local) return;
    this.closeLinks();
    useVoiceStore.setState({ status: 'joining', peers: {} });
    this.deps.send({ type: 'voice.join', data: { channelId, video: !!this.camera } });
  }

  handle(ev: WsServerMessage): void {
    const state = useVoiceStore.getState();
    switch (ev.type) {
      case 'voice.state':
        useVoiceStore.setState((s) => ({
          participants: { ...s.participants, [ev.data.channelId]: ev.data.peers },
        }));
        return;
      case 'voice.joined': {
        if (ev.data.channelId !== state.channelId) return;
        useVoiceStore.setState({
          status: 'connected',
          selfPeerId: ev.data.peerId,
          peers: Object.fromEntries(ev.data.peers.map((p) => [p.peerId, peerState(p)])),
        });
        if (state.muted) this.deps.send({ type: 'voice.mute', data: { muted: true } });
        if (state.incoming?.channelId === ev.data.channelId)
          useVoiceStore.setState({ incoming: null });
        if (this.deps.reportTurnUsage && !this.meterTimer) {
          this.meterTimer = setInterval(() => {
            for (const link of this.links.values()) void this.meter(link);
          }, TURN_METER_INTERVAL_MS);
        }
        for (const peer of ev.data.peers) void this.offerTo(peer.peerId);
        return;
      }
      case 'voice.peer-joined':
        if (ev.data.channelId !== state.channelId) return;
        useVoiceStore.setState((s) => ({
          peers: { ...s.peers, [ev.data.peer.peerId]: peerState(ev.data.peer) },
        }));
        // They will send the offer.
        return;
      case 'voice.peer-left':
        if (ev.data.channelId !== state.channelId) return;
        this.closeLink(ev.data.peerId);
        useVoiceStore.setState((s) => {
          const peers = { ...s.peers };
          delete peers[ev.data.peerId];
          return { peers };
        });
        return;
      case 'voice.peer-muted':
        patchPeer(ev.data.peerId, { muted: ev.data.muted });
        return;
      case 'voice.peer-video':
        patchPeer(ev.data.peerId, { video: ev.data.video });
        return;
      case 'call.ring':
        // Already in this call (e.g. on this device): nothing to answer.
        if (state.channelId === ev.data.channelId) return;
        useVoiceStore.setState({ incoming: ev.data });
        return;
      case 'call.ended': {
        if (state.incoming?.channelId === ev.data.channelId)
          useVoiceStore.setState({ incoming: null });
        // Our call was turned down while we were still alone in it.
        if (
          ev.data.reason === 'declined' &&
          state.channelId === ev.data.channelId &&
          Object.keys(state.peers).length === 0
        ) {
          this.leave();
          useVoiceStore.setState({ error: 'Der Anruf wurde abgelehnt.' });
        }
        return;
      }
      case 'voice.left':
        if (ev.data.channelId !== state.channelId) return;
        this.teardown(
          ev.data.reason === 'other-device'
            ? 'Du bist jetzt auf einem anderen Gerät im Sprachkanal.'
            : null,
        );
        return;
      case 'voice.signal':
        void this.onSignal(ev.data.from, ev.data.signal);
        return;
      case 'error':
        if (
          ev.data.channelId &&
          ev.data.channelId === state.channelId &&
          state.status === 'joining'
        ) {
          this.teardown(
            ev.data.code === 'VOICE_FULL'
              ? 'Der Sprachkanal ist voll.'
              : (ev.data.message ?? 'Beitreten nicht möglich.'),
          );
        }
        return;
      default:
        return;
    }
  }

  private async offerTo(peerId: string): Promise<void> {
    const link = this.link(peerId, true);
    const offer = await link.pc.createOffer();
    await link.pc.setLocalDescription(offer);
    this.signal(peerId, { type: 'offer', sdp: offer.sdp ?? '' });
  }

  private async onSignal(from: string, signal: VoiceSignal): Promise<void> {
    if (!this.local || !useVoiceStore.getState().channelId) return;
    try {
      if (signal.type === 'offer') {
        const link = this.links.get(from) ?? this.link(from, false);
        await link.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        if (!link.video) {
          // The offer brought a video line: answer it as sendrecv, with our camera if it is on.
          link.video = link.pc
            .getTransceivers?.()
            .find((t) => t.receiver.track?.kind === 'video' && t.currentDirection !== 'stopped');
          if (link.video) {
            link.video.direction = 'sendrecv';
            await this.sendCamera(link);
          }
        }
        await this.flush(link);
        const answer = await link.pc.createAnswer();
        await link.pc.setLocalDescription(answer);
        this.signal(from, { type: 'answer', sdp: answer.sdp ?? '' });
      } else if (signal.type === 'answer') {
        const link = this.links.get(from);
        if (!link) return;
        await link.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        await this.flush(link);
      } else if (signal.type === 'candidate') {
        const link = this.links.get(from);
        if (!link) return;
        if (link.pc.remoteDescription) await link.pc.addIceCandidate(signal.candidate);
        else link.pending.push(signal.candidate);
      }
    } catch {
      patchPeer(from, { connection: 'failed' });
    }
  }

  private async flush(link: Link): Promise<void> {
    for (const c of link.pending.splice(0)) await link.pc.addIceCandidate(c).catch(() => undefined);
  }

  private link(peerId: string, initiator: boolean): Link {
    const existing = this.links.get(peerId);
    if (existing) return existing;
    const pc = this.deps.createPeerConnection({ iceServers: this.iceServers });
    const audio = this.deps.createAudio();
    if (this.outputId) void (audio as SinkAudio).setSinkId?.(this.outputId).catch(() => undefined);
    const link: Link = { peerId, pc, initiator, pending: [], audio, reported: new Map() };
    this.links.set(peerId, link);
    for (const track of this.local?.getTracks() ?? []) pc.addTrack(track, this.local!);
    // The offering side always opens a video line, so the camera can be switched on later.
    if (initiator && pc.addTransceiver) {
      link.video = pc.addTransceiver(this.camera ?? 'video', {
        direction: 'sendrecv',
        streams: this.local ? [this.local] : [],
      });
      if (this.camera) void this.sendCamera(link);
    }

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      const c = ev.candidate.toJSON();
      this.signal(peerId, {
        type: 'candidate',
        candidate: {
          candidate: c.candidate ?? '',
          sdpMid: c.sdpMid ?? null,
          sdpMLineIndex: c.sdpMLineIndex ?? null,
          usernameFragment: c.usernameFragment ?? null,
        },
      });
    };
    pc.ontrack = (ev) => {
      // Audio and video may arrive in different streams (browsers differ): keep one per person.
      if (!link.remote) link.remote = ev.streams[0] ?? new MediaStream([ev.track]);
      else if (!link.remote.getTracks().includes(ev.track)) link.remote.addTrack(ev.track);
      const stream = link.remote;
      if (audio.srcObject !== stream) audio.srcObject = stream;
      void audio.play().catch(() => undefined);
      if (ev.track.kind === 'audio') link.analyser = this.analyse(stream) ?? undefined;
      useVoiceStore.setState((s) => ({ streams: { ...s.streams, [peerId]: stream } }));
    };
    pc.onconnectionstatechange = () => {
      patchPeer(peerId, { connection: pc.connectionState });
      // A dropped path (e.g. Wi-Fi → mobile data): the offering side renegotiates with ICE restart.
      if (pc.connectionState === 'failed' && link.initiator) {
        pc.restartIce?.();
        void pc
          .createOffer({ iceRestart: true })
          .then((o) => pc.setLocalDescription(o).then(() => o))
          .then((o) => this.signal(peerId, { type: 'offer', sdp: o.sdp ?? '' }))
          .catch(() => undefined);
      }
    };
    return link;
  }

  private signal(to: string, signal: VoiceSignal): void {
    this.deps.send({ type: 'voice.signal', data: { to, signal } });
  }

  private applyMute(muted: boolean): void {
    for (const t of this.local?.getAudioTracks() ?? []) t.enabled = !muted;
  }

  /** Reports the relayed bytes of one connection since its last report. */
  private async meter(link: Link): Promise<void> {
    if (!this.deps.reportTurnUsage) return;
    let delta = 0;
    try {
      for (const [pair, total] of await relayedBytes(link.pc)) {
        delta += Math.max(0, total - (link.reported.get(pair) ?? 0));
        link.reported.set(pair, total);
      }
    } catch {
      return;
    }
    if (delta > 0) this.deps.reportTurnUsage(delta);
  }

  private closeLink(peerId: string): void {
    const link = this.links.get(peerId);
    if (!link) return;
    this.links.delete(peerId);
    link.pc.onicecandidate = null;
    link.pc.ontrack = null;
    link.pc.onconnectionstatechange = null;
    if (this.deps.reportTurnUsage) {
      // Last measurement before closing, so the final seconds of a relayed call count too.
      void this.meter(link).finally(() => link.pc.close());
    } else {
      link.pc.close();
    }
    link.audio.srcObject = null;
    link.audio.remove();
    useVoiceStore.setState((s) => {
      if (!s.streams[peerId]) return {};
      const streams = { ...s.streams };
      delete streams[peerId];
      return { streams };
    });
  }

  private closeLinks(): void {
    for (const id of [...this.links.keys()]) this.closeLink(id);
  }

  private teardown(error: string | null): void {
    this.closeLinks();
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.camera?.stop();
    this.camera = null;
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
    this.localAnalyser = null;
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    useVoiceStore.setState({
      channelId: null,
      guildId: null,
      status: 'idle',
      selfPeerId: null,
      selfSpeaking: false,
      video: false,
      localVideo: null,
      streams: {},
      peers: {},
      error,
    });
  }

  // --- speaking indicator ----------------------------------------------------------------------

  private startLevels(): void {
    if (!this.deps.createAudioContext || this.audioContext) return;
    try {
      this.audioContext = this.deps.createAudioContext();
      void this.audioContext.resume?.().catch(() => undefined);
    } catch {
      this.audioContext = null;
      return;
    }
    this.levelTimer = setInterval(() => this.sampleLevels(), 150);
  }

  private watchLocal(): void {
    if (this.local) this.localAnalyser = this.analyse(this.local);
  }

  private analyse(stream: MediaStream): AnalyserNode | null {
    if (!this.audioContext) return null;
    try {
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 512;
      this.audioContext.createMediaStreamSource(stream).connect(analyser);
      return analyser;
    } catch {
      return null;
    }
  }

  private sampleLevels(): void {
    const { muted, selfSpeaking, peers } = useVoiceStore.getState();
    const self = !muted && level(this.localAnalyser) > SPEAKING_LEVEL;
    if (self !== selfSpeaking) useVoiceStore.setState({ selfSpeaking: self });
    for (const link of this.links.values()) {
      const speaking = level(link.analyser) > SPEAKING_LEVEL;
      if (peers[link.peerId] && peers[link.peerId]!.speaking !== speaking) {
        patchPeer(link.peerId, { speaking });
      }
    }
  }
}

function level(analyser: AnalyserNode | null | undefined): number {
  if (!analyser) return 0;
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const v of data) sum += v * v;
  return Math.sqrt(sum / data.length);
}

function peerState(p: VoicePeerDto) {
  return { ...p, connection: 'new' as const, speaking: false };
}
