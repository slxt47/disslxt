import { execFile, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { VOICE_MAX_SECONDS } from '@disslxt/shared';

const run = promisify(execFile);

export type AudioContainer = 'webm' | 'ogg' | 'mp4' | 'mpeg' | 'wav' | 'aac';

/**
 * Detects the container from the first bytes. The upload's Content-Type is only a claim; this
 * is what decides whether the file is accepted at all (and what ffmpeg is told to expect).
 */
export function sniffAudio(buf: Buffer): AudioContainer | null {
  if (buf.length < 12) return null;
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return 'webm'; // EBML (WebM/Matroska)
  if (buf.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') {
    return 'wav';
  }
  if (buf.toString('latin1', 0, 3) === 'ID3') return 'mpeg';
  // ADTS AAC (0xFFF1 / 0xFFF9) and MPEG audio frames (0xFFEx / 0xFFFx).
  if (buf[0] === 0xff && ((buf[1] ?? 0) & 0xf6) === 0xf0) return 'aac';
  if (buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0) return 'mpeg';
  return null;
}

const MIME: Record<AudioContainer, string> = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  mp4: 'audio/mp4',
  mpeg: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
};
const EXT: Record<AudioContainer, string> = {
  webm: 'webm',
  ogg: 'ogg',
  mp4: 'm4a',
  mpeg: 'mp3',
  wav: 'wav',
  aac: 'aac',
};

export interface StoredAudio {
  /** File name inside the voice directory. */
  key: string;
  mime: string;
  durationMs: number;
}

export interface Transcoder {
  /** Stores `input` in `dir`, converted if the implementation does that. */
  store(
    input: Buffer,
    container: AudioContainer,
    dir: string,
    clientDurationMs: number,
  ): Promise<StoredAudio>;
}

const newKey = (ext: string) => `${randomBytes(16).toString('hex')}.${ext}`;

/**
 * Converts every recording to AAC in an MP4 container (.m4a): the one format that plays in all
 * browsers, including Safari on iOS, which cannot play WebM/Opus from Chrome everywhere. Mono,
 * 64 kbit/s is plenty for speech (≈ 1 MB for the 2 minutes maximum). `-t` caps the length no
 * matter what the client claims.
 */
export class FfmpegTranscoder implements Transcoder {
  constructor(
    private readonly ffmpeg = 'ffmpeg',
    private readonly ffprobe = 'ffprobe',
  ) {}

  async store(input: Buffer, container: AudioContainer, dir: string): Promise<StoredAudio> {
    const work = join(tmpdir(), `voice-${randomBytes(8).toString('hex')}`);
    await mkdir(work, { recursive: true });
    const src = join(work, `in.${EXT[container]}`);
    const key = newKey('m4a');
    const out = join(dir, key);
    try {
      await writeFile(src, input);
      await run(
        this.ffmpeg,
        [
          ...['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'],
          ...['-i', src, '-t', String(VOICE_MAX_SECONDS), '-vn', '-map_metadata', '-1'],
          ...['-ac', '1', '-ar', '48000', '-c:a', 'aac', '-b:a', '64k'],
          ...['-movflags', '+faststart', '-f', 'mp4', out],
        ],
        { timeout: 60_000 },
      );
      const { stdout } = await run(
        this.ffprobe,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out],
        { timeout: 15_000 },
      );
      const seconds = Number.parseFloat(stdout.trim());
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('no audio in recording');
      return { key, mime: 'audio/mp4', durationMs: Math.round(seconds * 1000) };
    } catch (err) {
      await rm(out, { force: true });
      throw err;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}

/** Without ffmpeg (local development, tests): keeps the upload as it is. */
export class PassthroughTranscoder implements Transcoder {
  async store(
    input: Buffer,
    container: AudioContainer,
    dir: string,
    clientDurationMs: number,
  ): Promise<StoredAudio> {
    const key = newKey(EXT[container]);
    await writeFile(join(dir, key), input);
    return {
      key,
      mime: MIME[container],
      durationMs: Math.min(Math.max(0, Math.round(clientDurationMs)), VOICE_MAX_SECONDS * 1000),
    };
  }
}

/** Picks the transcoder for VOICE_TRANSCODE (auto: ffmpeg when installed). */
export function createTranscoder(
  voice: { transcode: 'auto' | 'ffmpeg' | 'off'; ffmpegPath: string; ffprobePath: string },
  log: { warn: (msg: string) => void },
): Transcoder {
  if (voice.transcode === 'off') return new PassthroughTranscoder();
  if (ffmpegAvailable(voice.ffmpegPath)) {
    return new FfmpegTranscoder(voice.ffmpegPath, voice.ffprobePath);
  }
  if (voice.transcode === 'ffmpeg') throw new Error(`ffmpeg not found at ${voice.ffmpegPath}`);
  log.warn('ffmpeg not found: voice messages are stored unconverted (may not play on iOS)');
  return new PassthroughTranscoder();
}

export function ffmpegAvailable(ffmpeg = 'ffmpeg'): boolean {
  const r = spawnSync(ffmpeg, ['-version'], { stdio: 'ignore', timeout: 5000 });
  return r.status === 0;
}

/** True if the conversion failed because the input is not decodable audio. */
export function isBadInput(err: unknown): boolean {
  return (
    err instanceof Error &&
    /no audio|Invalid data|could not find codec|does not contain any stream/i.test(
      `${err.message} ${(err as { stderr?: string }).stderr ?? ''}`,
    )
  );
}
