import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/endpoints';
import { useRealtime } from '../realtime/RealtimeProvider';
import { resetVoiceStore } from '../store/voice';
import { VoiceClient } from './VoiceClient';

const VoiceContext = createContext<VoiceClient | null>(null);

export function useVoice(): VoiceClient | null {
  return useContext(VoiceContext);
}

/**
 * One voice session per tab, alive while logged in, so you stay in a voice channel while reading
 * text channels. Remote audio plays through hidden <audio> elements.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const realtime = useRealtime();
  const [client, setClient] = useState<VoiceClient | null>(null);

  useEffect(() => {
    if (!realtime) return;
    const sink = document.createElement('div');
    sink.hidden = true;
    sink.dataset.testid = 'voice-audio-sink';
    document.body.appendChild(sink);
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const c = new VoiceClient({
      send: (msg) => realtime.send(msg),
      iceServers: () => api.iceServers().then((r) => r.iceServers),
      getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
      createPeerConnection: (config) => new RTCPeerConnection(config),
      createAudio: () => {
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.setAttribute('playsinline', '');
        sink.appendChild(audio);
        return audio;
      },
      createAudioContext: AudioCtx ? () => new AudioCtx() : undefined,
      reportTurnUsage: (bytes) => void api.reportTurnUsage(bytes).catch(() => undefined),
    });
    const offEvent = realtime.onEvent((ev) => c.handle(ev));
    const offReady = realtime.onReady(({ reconnect }) => {
      if (reconnect) c.rejoinAfterReconnect();
    });
    setClient(c);
    return () => {
      offEvent();
      offReady();
      c.leave();
      resetVoiceStore();
      sink.remove();
      setClient(null);
    };
  }, [realtime]);

  return <VoiceContext.Provider value={client}>{children}</VoiceContext.Provider>;
}

export function voiceSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}
