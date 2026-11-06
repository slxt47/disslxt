import { spawn } from 'node:child_process';

/** Turns a stored voice message into text. */
export type Transcriber = (audioPath: string) => Promise<string>;

const TIMEOUT_MS = 5 * 60 * 1000;

/** What Whisper invents for silence or noise: stage directions and subtitle credits. */
const NOISE = [
  /\[[^\]]*\]/g,
  /\([^)]*\)/g,
  /\*[^*]*\*/g,
  /untertitel(ung)?\b[^.]*\.?/gi,
  /copyright\b[^.]*\.?/gi,
];

export function cleanTranscript(text: string): string {
  return NOISE.reduce((t, re) => t.replace(re, ' '), text)
    .replace(/\s+/g, ' ')
    .trim();
}

/** 16 kHz mono WAV, the format Whisper works on. */
function toWav(audioPath: string, ffmpeg: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpeg,
      ['-v', 'error', '-i', audioPath, '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const chunks: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg ${code}`)),
    );
  });
}

/** Asks the local whisper container; the audio never leaves the server. */
export function whisperTranscriber(baseUrl: string, ffmpeg: string): Transcriber {
  return async (audioPath) => {
    const form = new FormData();
    form.set('file', new Blob([await toWav(audioPath, ffmpeg)], { type: 'audio/wav' }), 'a.wav');
    form.set('response_format', 'json');
    const res = await fetch(`${baseUrl}/inference`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`whisper ${res.status}`);
    const { text } = (await res.json()) as { text?: string };
    return text ?? '';
  };
}
