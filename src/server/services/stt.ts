import {
  ProviderError,
  isAbortError,
  type SttProvider,
  type SttSegment,
  type SttWord,
} from '../providers/types.js';
import type { Chunk } from './chunker.js';
import type { JobLogger } from './joblog.js';

/** Phrases Whisper hallucinates on silence/music (matched case-insensitively on the whole segment). */
const FILLER_PATTERNS: RegExp[] = [
  /thanks? (you )?for watching/i,
  /please (like and )?subscribe/i,
  /subtitles? (by|made by|created by)/i,
  /amara\.org/i,
  /subtitled by/i,
  /transcribed by/i,
  /captions? by/i,
  /www\.[a-z0-9-]+\.(com|org|net)/i,
  /^\s*(\[|\()?\s*(music|applause|silence|blank_audio)\s*(\]|\))?\s*$/i,
  /hvala (vam )?(što ste|na) (gledali|gledanju)/i,
  /prevod(io|ila)? (i|&) obrad/i,
  /untertitel (im auftrag|von)/i,
  /sous-titres? (réalisés|par)/i,
  /^\s*\.+\s*$/,
];

export function isFiller(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return FILLER_PATTERNS.some((re) => re.test(t));
}

/**
 * Removes typical Whisper hallucinations: low-confidence non-speech segments, credit/filler phrases,
 * and runs of ≥ 3 identical consecutive segments (keeps the first).
 */
export function filterHallucinations(segments: SttSegment[]): {
  kept: SttSegment[];
  dropped: number;
} {
  const kept: SttSegment[] = [];
  let dropped = 0;
  let runText = '';
  let runCount = 0;
  for (const seg of segments) {
    const text = seg.text.trim();
    const norm = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (norm === runText) runCount++;
    else {
      runText = norm;
      runCount = 1;
    }
    const noSpeech = (seg.noSpeechProb ?? 0) > 0.6 && (seg.avgLogprob ?? 0) < -1;
    if (noSpeech || isFiller(text) || runCount >= 3) {
      dropped++;
      continue;
    }
    // Two identical in a row are allowed ("No. No."), the third onwards is dropped.
    kept.push(seg);
  }
  return { kept, dropped };
}

/** Keeps only words that fall inside a kept segment. */
export function filterWords(words: SttWord[], segments: SttSegment[]): SttWord[] {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  return words.filter((w) => {
    const mid = (w.start + w.end) / 2;
    return sorted.some((s) => mid >= s.start - 0.1 && mid <= s.end + 0.1);
  });
}

/** Builds pseudo-segments from words when a provider returns words only. */
export function segmentsFromWords(words: SttWord[]): SttSegment[] {
  const segs: SttSegment[] = [];
  let cur: SttWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    segs.push({
      start: cur[0]!.start,
      end: cur[cur.length - 1]!.end,
      text: cur.map((w) => w.word.trim()).join(' '),
    });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > 0.8 || cur.length >= 25 || /[.?!]$/.test(prev.word.trim())))
      flush();
    cur.push(w);
  }
  flush();
  return segs;
}

export function majorityLanguage(langs: (string | undefined)[], weights?: number[]): string | null {
  const score = new Map<string, number>();
  langs.forEach((l, i) => {
    if (!l) return;
    score.set(l, (score.get(l) ?? 0) + (weights?.[i] ?? 1));
  });
  let best: string | null = null;
  let bestScore = -1;
  for (const [l, s] of score) {
    if (s > bestScore) {
      best = l;
      bestScore = s;
    }
  }
  return best;
}

/** Runs `fn` over items with at most `limit` in flight; preserves order of results. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed: unknown = null;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && failed === null) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (err) {
        failed ??= err;
      }
    }
  });
  await Promise.all(workers);
  if (failed !== null) throw failed;
  return results;
}

export interface TranscribeOptions {
  chunks: Chunk[];
  /** Returns the MP3 bytes for a chunk. */
  loadChunk: (chunk: Chunk) => Promise<Buffer>;
  provider: SttProvider;
  model: string;
  fallbackModel?: string;
  language?: string;
  concurrency: number;
  signal?: AbortSignal;
  log: JobLogger;
  onCall: (call: {
    model: string;
    ms: number;
    costUsd: number | null;
    seconds: number;
    ok: boolean;
    error?: string;
  }) => void;
  onChunkDone?: (done: number, total: number) => void;
}

export interface TranscribeResult {
  segments: SttSegment[];
  words: SttWord[];
  detectedLang: string | null;
  droppedSegments: number;
  usedWordTimestamps: boolean;
}

export async function transcribeChunks(o: TranscribeOptions): Promise<TranscribeResult> {
  let done = 0;
  let wordsSupported = true;
  const perChunk = await mapLimit(o.chunks, o.concurrency, async (chunk) => {
    const audio = await o.loadChunk(chunk);
    const seconds = chunk.end - chunk.start;
    const attempt = async (model: string) => {
      const granularities: ('word' | 'segment')[] = wordsSupported
        ? ['word', 'segment']
        : ['segment'];
      const t0 = Date.now();
      try {
        const r = await o.provider.transcribe({
          audio,
          format: 'mp3',
          model,
          language: o.language,
          granularities,
          signal: o.signal,
        });
        o.onCall({ model, ms: Date.now() - t0, costUsd: r.costUsd, seconds, ok: true });
        return r;
      } catch (err) {
        if (isAbortError(err)) throw err;
        o.onCall({
          model,
          ms: Date.now() - t0,
          costUsd: 0,
          seconds,
          ok: false,
          error: (err as Error).message,
        });
        // Providers that do not support word timestamps answer 400: retry with segments only.
        if (err instanceof ProviderError && err.status === 400 && granularities.includes('word')) {
          if (wordsSupported)
            o.log(
              'warn',
              `${model} rejected word timestamps, retrying with segment timestamps only`,
            );
          wordsSupported = false;
          const t1 = Date.now();
          const r = await o.provider.transcribe({
            audio,
            format: 'mp3',
            model,
            language: o.language,
            granularities: ['segment'],
            signal: o.signal,
          });
          o.onCall({ model, ms: Date.now() - t1, costUsd: r.costUsd, seconds, ok: true });
          return r;
        }
        throw err;
      }
    };
    let result;
    try {
      result = await attempt(o.model);
    } catch (err) {
      if (isAbortError(err) || !o.fallbackModel || o.fallbackModel === o.model) throw err;
      o.log(
        'warn',
        `STT with ${o.model} failed (${(err as Error).message}); trying fallback ${o.fallbackModel}`,
      );
      result = await attempt(o.fallbackModel);
    }
    done++;
    o.onChunkDone?.(done, o.chunks.length);
    o.log(
      'info',
      `Transcribed chunk ${chunk.index + 1}/${o.chunks.length} (${Math.round(seconds)} s, ${result.segments.length} segments, ${result.words.length} words)`,
    );

    let segments = result.segments;
    if (segments.length === 0 && result.words.length > 0)
      segments = segmentsFromWords(result.words);
    if (segments.length === 0 && result.text.trim())
      segments = [{ start: 0, end: seconds, text: result.text.trim() }];
    // Offset to absolute time and clamp to the chunk.
    const offset = (t: number) => Math.min(chunk.end, chunk.start + Math.max(0, t));
    return {
      language: result.language,
      seconds,
      segments: segments.map((s) => ({ ...s, start: offset(s.start), end: offset(s.end) })),
      words: result.words.map((w) => ({ ...w, start: offset(w.start), end: offset(w.end) })),
    };
  });

  const allSegments = perChunk.flatMap((c) => c.segments).sort((a, b) => a.start - b.start);
  const allWords = perChunk.flatMap((c) => c.words).sort((a, b) => a.start - b.start);
  const { kept, dropped } = filterHallucinations(allSegments);
  if (dropped > 0) o.log('info', `Hallucination filter removed ${dropped} segment(s)`);
  return {
    segments: kept,
    words: filterWords(allWords, kept),
    detectedLang: majorityLanguage(
      perChunk.map((c) => c.language),
      perChunk.map((c) => c.seconds),
    ),
    droppedSegments: dropped,
    usedWordTimestamps: allWords.length > 0,
  };
}
