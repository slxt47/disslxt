import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FfmpegTranscoder, ffmpegAvailable, isBadInput, sniffAudio } from '../src/lib/voice.js';

// Real conversion; runs where ffmpeg is installed (the backend image, CI), skipped elsewhere.
describe.skipIf(!ffmpegAvailable())('FfmpegTranscoder (real ffmpeg)', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'disslxt-ffmpeg-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  /** A 3-second tone recorded the way Chrome does it: WebM with Opus. */
  function webmOpus(seconds: number): Buffer {
    const out = join(dir, `src-${seconds}.webm`);
    execFileSync('ffmpeg', [
      ...['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi'],
      ...['-i', `sine=frequency=440:duration=${seconds}`, '-c:a', 'libopus', out],
    ]);
    return readFileSync(out);
  }

  it('converts WebM/Opus to AAC in MP4 (.m4a) and measures the real length', async () => {
    const input = webmOpus(3);
    expect(sniffAudio(input)).toBe('webm');
    const stored = await new FfmpegTranscoder().store(input, 'webm', dir);
    expect(stored.key).toMatch(/^[0-9a-f]{32}\.m4a$/);
    expect(stored.mime).toBe('audio/mp4');
    expect(stored.durationMs).toBeGreaterThan(2900);
    expect(stored.durationMs).toBeLessThan(3200);
    const file = await readFile(join(dir, stored.key));
    expect(sniffAudio(file)).toBe('mp4');
    const codec = execFileSync('ffprobe', [
      ...['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels'],
      ...['-of', 'csv=p=0', join(dir, stored.key)],
    ])
      .toString()
      .trim();
    expect(codec).toBe('aac,1');
  });

  it('cuts recordings longer than 2 minutes', async () => {
    const stored = await new FfmpegTranscoder().store(webmOpus(125), 'webm', dir);
    expect(stored.durationMs).toBeLessThanOrEqual(120_100);
    expect((await stat(join(dir, stored.key))).size).toBeLessThan(1_500_000);
  });

  it('garbage with a valid header is reported as bad input', async () => {
    const fake = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(500, 1)]);
    const err = await new FfmpegTranscoder().store(fake, 'webm', dir).catch((e: unknown) => e);
    expect(isBadInput(err)).toBe(true);
  });
});
