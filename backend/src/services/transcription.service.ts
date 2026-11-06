import type { FastifyBaseLogger } from 'fastify';
import { MESSAGE_MAX_LEN } from '@disslxt/shared';
import { cleanTranscript, type Transcriber } from '../lib/whisper.js';

/** Voice messages waiting at most; beyond that a recording simply stays without text. */
const MAX_WAITING = 50;

/**
 * Writes voice messages down, one at a time: speech recognition takes several CPU cores, and chat
 * must stay fast meanwhile. Without a transcriber nothing happens.
 */
export class TranscriptionService {
  private readonly queue: { path: string; done: (text: string) => Promise<void> }[] = [];
  private running: Promise<void> | null = null;

  constructor(
    private readonly transcribe: Transcriber | null,
    private readonly log: FastifyBaseLogger,
  ) {}

  enqueue(path: string, done: (text: string) => Promise<void>): void {
    if (!this.transcribe || this.queue.length >= MAX_WAITING) return;
    this.queue.push({ path, done });
    this.running ??= this.drain().finally(() => (this.running = null));
  }

  private async drain(): Promise<void> {
    for (let job = this.queue.shift(); job; job = this.queue.shift()) {
      try {
        const text = [...cleanTranscript((await this.transcribe?.(job.path)) ?? '')]
          .slice(0, MESSAGE_MAX_LEN)
          .join('');
        if (text) await job.done(text);
      } catch (err) {
        // The recording is there either way; it only stays without text.
        this.log.warn({ err }, 'transcription failed');
      }
    }
  }

  /** Waits for the queue (tests, shutdown). */
  async settled(): Promise<void> {
    await this.running;
  }
}
