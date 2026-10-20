import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import type { AudioTrack, SubtitleTrack } from '../../shared/types.js';

export const FFMPEG =
  (process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string | null)) ?? 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || ffprobeStatic.path || 'ffprobe';

export const VIDEO_EXTENSIONS = new Set([
  '.mkv',
  '.mp4',
  '.m4v',
  '.avi',
  '.mov',
  '.wmv',
  '.ts',
  '.m2ts',
  '.mts',
  '.webm',
  '.flv',
  '.mpg',
  '.mpeg',
  '.3gp',
  '.ogv',
  '.divx',
  '.vob',
]);
export const SUBTITLE_EXTENSIONS = new Set(['.srt']);
export const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'mov_text',
  'webvtt',
  'text',
]);

export function isVideoFile(file: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase());
}

export class ToolError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

interface RunResult {
  stdout: Buffer;
  stderr: string;
}

/** Runs a binary, killing it when `signal` aborts. Rejects on non-zero exit. */
export function run(bin: string, args: string[], signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
    });
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(
        new ToolError(
          `Could not start ${path.basename(bin)}: ${err.message}. Re-run "npm install" so ffmpeg-static can download its binary.`,
          '',
        ),
      );
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(abortError());
      if (code === 0) return resolve({ stdout: Buffer.concat(out), stderr });
      const tail = stderr.trim().split('\n').slice(-6).join('\n');
      reject(new ToolError(`${path.basename(bin)} exited with code ${code}: ${tail}`, stderr));
    });
  });
}

function abortError(): Error {
  const e = new Error('Cancelled');
  e.name = 'AbortError';
  return e;
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

export interface ProbeResult {
  durationSec: number | null;
  formatName: string;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
}

interface FfprobeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  channels?: number;
  duration?: string;
  tags?: Record<string, string>;
}

function tag(tags: Record<string, string> | undefined, key: string): string | null {
  if (!tags) return null;
  const found = Object.entries(tags).find(([k]) => k.toLowerCase() === key);
  return found ? found[1] : null;
}

export async function probe(file: string, signal?: AbortSignal): Promise<ProbeResult> {
  const { stdout } = await run(
    FFPROBE,
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
    signal,
  );
  const json = JSON.parse(stdout.toString('utf8')) as {
    streams?: FfprobeStream[];
    format?: { duration?: string; format_name?: string };
  };
  const streams = json.streams ?? [];
  const audio = streams.filter((s) => s.codec_type === 'audio');
  const subs = streams.filter((s) => s.codec_type === 'subtitle');
  let duration = Number(json.format?.duration);
  if (!Number.isFinite(duration)) {
    duration = Math.max(0, ...streams.map((s) => Number(s.duration) || 0));
  }
  return {
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
    formatName: json.format?.format_name ?? '',
    audioTracks: audio.map((s, i) => ({
      index: i,
      streamIndex: s.index,
      language: normalizeTrackLang(tag(s.tags, 'language')),
      codec: s.codec_name ?? 'unknown',
      channels: s.channels ?? 0,
      title: tag(s.tags, 'title'),
    })),
    subtitleTracks: subs.map((s, i) => ({
      index: i,
      streamIndex: s.index,
      language: normalizeTrackLang(tag(s.tags, 'language')),
      codec: s.codec_name ?? 'unknown',
      textBased: TEXT_SUBTITLE_CODECS.has(s.codec_name ?? ''),
      title: tag(s.tags, 'title'),
    })),
  };
}

/** ISO 639-2 (`eng`, `hrv`, `scr`) → ISO 639-1 (`en`, `hr`). */
const ISO3: Record<string, string> = {
  eng: 'en',
  hrv: 'hr',
  scr: 'hr',
  srp: 'sr',
  scc: 'sr',
  bos: 'bs',
  slv: 'sl',
  mkd: 'mk',
  mac: 'mk',
  deu: 'de',
  ger: 'de',
  fra: 'fr',
  fre: 'fr',
  spa: 'es',
  ita: 'it',
  por: 'pt',
  nld: 'nl',
  dut: 'nl',
  pol: 'pl',
  ces: 'cs',
  cze: 'cs',
  slk: 'sk',
  slo: 'sk',
  hun: 'hu',
  ron: 'ro',
  rum: 'ro',
  sqi: 'sq',
  alb: 'sq',
  bul: 'bg',
  rus: 'ru',
  ukr: 'uk',
  bel: 'be',
  ell: 'el',
  gre: 'el',
  tur: 'tr',
  heb: 'he',
  ara: 'ar',
  fas: 'fa',
  per: 'fa',
  lit: 'lt',
  lav: 'lv',
  est: 'et',
  fin: 'fi',
  swe: 'sv',
  dan: 'da',
  nor: 'no',
  nob: 'no',
  isl: 'is',
  ice: 'is',
  cat: 'ca',
  vie: 'vi',
  tha: 'th',
  jpn: 'ja',
  kor: 'ko',
  zho: 'zh',
  chi: 'zh',
  hin: 'hi',
  ind: 'id',
  msa: 'ms',
  may: 'ms',
};

export function normalizeTrackLang(lang: string | null): string | null {
  if (!lang) return null;
  const l = lang.toLowerCase();
  if (l === 'und' || l === 'unk' || l === 'mis') return null;
  return ISO3[l] ?? (l.length === 2 ? l : l);
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/** Picks the audio track whose language matches the source language, else the first. */
export function chooseAudioTrack(
  tracks: AudioTrack[],
  sourceLang: string | null,
  override?: number,
): AudioTrack | null {
  if (override !== undefined) return tracks.find((t) => t.index === override) ?? tracks[0] ?? null;
  if (sourceLang && sourceLang !== 'auto') {
    const iso = sourceLang.split('-')[0]!.toLowerCase();
    const match = tracks.find((t) => t.language === iso);
    if (match) return match;
  }
  return tracks[0] ?? null;
}

/** Extracts one audio track as mono 16 kHz PCM WAV. */
export async function extractAudio(
  video: string,
  audioIndex: number,
  out: string,
  signal?: AbortSignal,
): Promise<void> {
  await run(
    FFMPEG,
    [
      '-nostdin',
      '-y',
      '-v',
      'error',
      '-i',
      video,
      '-map',
      `0:a:${audioIndex}`,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      out,
    ],
    signal,
  );
}

export interface Silence {
  start: number;
  end: number;
}

/** Parses `silence_start` / `silence_end` lines from ffmpeg's silencedetect filter. */
export function parseSilences(stderr: string): Silence[] {
  const silences: Silence[] = [];
  let start: number | null = null;
  for (const line of stderr.split('\n')) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) {
      start = Math.max(0, Number(s[1]));
      continue;
    }
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && start !== null) {
      silences.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  return silences;
}

export async function detectSilences(wav: string, signal?: AbortSignal): Promise<Silence[]> {
  const { stderr } = await run(
    FFMPEG,
    [
      '-nostdin',
      '-hide_banner',
      '-i',
      wav,
      '-af',
      'silencedetect=noise=-35dB:d=0.4',
      '-f',
      'null',
      '-',
    ],
    signal,
  );
  return parseSilences(stderr);
}

/** Encodes a time range of the WAV to mono 16 kHz MP3 (48 kbps) and returns the bytes. */
export async function encodeMp3(
  wav: string,
  startSec: number,
  endSec: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const { stdout } = await run(
    FFMPEG,
    [
      '-nostdin',
      '-v',
      'error',
      '-ss',
      startSec.toFixed(3),
      '-t',
      Math.max(0.1, endSec - startSec).toFixed(3),
      '-i',
      wav,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '48k',
      '-f',
      'mp3',
      'pipe:1',
    ],
    signal,
  );
  return stdout;
}

// ---------------------------------------------------------------------------
// Subtitles
// ---------------------------------------------------------------------------

/** Extracts an embedded text subtitle stream (n-th subtitle track) as SRT text. */
export async function extractEmbeddedSubtitle(
  video: string,
  subIndex: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const { stdout } = await run(
    FFMPEG,
    [
      '-nostdin',
      '-v',
      'error',
      '-i',
      video,
      '-map',
      `0:s:${subIndex}`,
      '-c:s',
      'srt',
      '-f',
      'srt',
      'pipe:1',
    ],
    signal,
  );
  return stdout;
}

export interface Sidecar {
  path: string;
  /** Language guessed from the file name (`Ep.en.srt` → `en`), or null for `Ep.srt`. */
  language: string | null;
}

/** Finds `<base>.srt`, `<base>.en.srt`, `<base>.eng.srt`, `<base>.en.forced.srt` next to the video. */
export function findSidecars(video: string): Sidecar[] {
  const dir = path.dirname(video);
  const base = path.basename(video, path.extname(video));
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const result: Sidecar[] = [];
  for (const name of names) {
    if (path.extname(name).toLowerCase() !== '.srt') continue;
    if (!name.startsWith(base)) continue;
    const middle = name.slice(base.length, -4);
    if (middle === '') {
      result.push({ path: path.join(dir, name), language: null });
      continue;
    }
    const parts = middle.split('.').filter(Boolean);
    if (middle[0] !== '.' || parts.length === 0 || parts.length > 3) continue;
    const langPart = parts.find(
      (p) =>
        /^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(p) &&
        !/^(forced|sdh|cc|hi|osg)$/i.test(p) &&
        !VIDEO_EXTENSIONS.has(`.${p.toLowerCase()}`),
    );
    result.push({
      path: path.join(dir, name),
      language: normalizeTrackLang(langPart?.toLowerCase() ?? null),
    });
  }
  return result;
}
