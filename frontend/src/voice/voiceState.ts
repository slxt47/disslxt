import { api } from '../api/endpoints';
import { useVoiceStore } from '../store/voice';

/** Loads the participants of a guild's voice channels (empty ones included). */
export async function loadVoiceState(guildId: string, voiceChannelIds: string[]): Promise<void> {
  const { channels } = await api.voiceState(guildId);
  useVoiceStore.setState((s) => {
    const participants = { ...s.participants };
    for (const id of voiceChannelIds) participants[id] = channels[id] ?? [];
    return { participants };
  });
}
