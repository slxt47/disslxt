/** Unsent text per channel, kept on this device until it is sent or you log out. */
const PREFIX = 'disslxt:draft:';

export function loadDraft(channelId: string): string {
  try {
    return localStorage.getItem(PREFIX + channelId) ?? '';
  } catch {
    return '';
  }
}

export function saveDraft(channelId: string, text: string): void {
  try {
    if (text.trim()) localStorage.setItem(PREFIX + channelId, text);
    else localStorage.removeItem(PREFIX + channelId);
  } catch {
    // Without storage the text is just not kept across channels.
  }
}

/** On logout: nothing you wrote stays on a shared device. */
export function clearDrafts(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing stored, nothing to clear.
  }
}
