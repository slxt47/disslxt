/** Microphone / speaker selection helpers. */

/** Choosing the output device needs HTMLMediaElement.setSinkId (not in Safari / iOS). */
export function outputSelectable(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

export function audioConstraints(inputId: string): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    // "ideal": a remembered device that is gone (headset unplugged) falls back to the default.
    ...(inputId ? { deviceId: { ideal: inputId } } : {}),
  };
}

export interface AudioDevices {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}

/** Labels are only filled in once the page has microphone permission. */
export async function listAudioDevices(): Promise<AudioDevices> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: all.filter((d) => d.kind === 'audioinput'),
    outputs: all.filter((d) => d.kind === 'audiooutput'),
  };
}

export function deviceLabel(d: MediaDeviceInfo, i: number, kind: 'Mikrofon' | 'Ausgabe'): string {
  if (d.deviceId === 'default')
    return `Systemstandard${d.label ? ` (${d.label.replace(/^Default - /, '')})` : ''}`;
  return d.label || `${kind} ${i + 1}`;
}

/** Plays a short two-tone chime on the given output, to check speakers/headphones. */
export async function playTestTone(outputId: string): Promise<void> {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const dest = ctx.createMediaStreamDestination();
  const gain = ctx.createGain();
  gain.connect(dest);
  const audio = new Audio();
  audio.srcObject = dest.stream;
  if (outputId && outputSelectable()) {
    await (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> })
      .setSinkId(outputId)
      .catch(() => undefined);
  }
  await audio.play().catch(() => undefined);
  const t = ctx.currentTime;
  for (const [freq, start] of [
    [660, 0],
    [880, 0.18],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(t + start);
    osc.stop(t + start + 0.16);
  }
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
  setTimeout(() => {
    audio.pause();
    void ctx.close();
  }, 600);
}
