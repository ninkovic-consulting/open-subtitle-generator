import {
  ProviderError,
  isAbortError,
  type SttProvider,
  type SttSegment,
  type SttWord,
} from '../providers/types.js';
import type { Chunk } from './chunker.js';
import type { JobLogger } from './joblog.js';

/** Credit lines speech-to-text models invent over music or silence, in many languages. */
const FILLER_PATTERNS: RegExp[] = [
  /thanks? (you )?(so much |very much )?for watching/i,
  /please (like (and|&) )?subscribe/i,
  /subtitles? (by|made by|created by)/i,
  /amara\.org/i,
  /subtitled by/i,
  /transcribed by/i,
  /captions? by/i,
  /www\.[a-z0-9-]+\.(com|org|net)/i,
  /^\s*(\[|\()?\s*(music|applause|silence|blank_audio)\s*(\]|\))?\s*$/i,
  /hvala (vam )?(što ste|na) (gledali|gledanju)/i,
  /prevod(io|ila)? (i|&) obrad/i,
  /untertitel(ung)? (im auftrag|von|des|der)/i,
  /sous-titr(es?|age) (réalisés|par|société|st'?\s*\d+)/i,
  /société radio-canada/i,
  /sottotitoli (creati|a cura|di)/i,
  /napisy (wykonane|stworzone|przygotowane)/i,
  /titulky (vytvořil|vytvořila|připravil)/i,
  /ondertiteling (door|van)/i,
  /субтитр(ы|ов) (сделал|подготов|создал)/i,
  /продолжение следует/i,
  /ご視聴ありがとうございました/,
  /字幕(由|制作|提供)/,
  /^\s*\.+\s*$/,
];

export function isFiller(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return FILLER_PATTERNS.some((re) => re.test(t));
}

const ANNOTATION_RE = /\*[^*\n]{0,60}\*|\[[^\]\n]{0,60}\]|\([^)\n]{0,60}\)|[♪♫🎵🎶]+/gu;
const SOUND_WORD_RE =
  /^(sighs?|sighing|laughs?|laughing|chuckles?|chuckling|grunts?|grunting|groans?|groaning|gasps?|gasping|screams?|screaming|coughs?|coughing|music|applause|silence|blank_audio|inaudible|indistinct|crying|sobbing|panting|breathing|growling|whistling|knocking|footsteps)$/i;

/** Removes sound annotations (*Dramatic music*, [Screaming], (sighs), ♪) and dash-only leftovers. */
export function stripAnnotations(text: string): string {
  return text
    .replace(ANNOTATION_RE, ' ')
    .split('\n')
    .map((l) =>
      l
        .replace(/\s{2,}/g, ' ')
        .trim()
        .replace(/^(-\s*)+$/, '')
        .replace(/^-\s*(-\s*)+/, '- '),
    )
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** True when nobody says anything: only music notes, sound tags, sound words or punctuation. */
export function isNonSpeech(text: string): boolean {
  const words = stripAnnotations(text)
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.length === 0 || words.every((w) => SOUND_WORD_RE.test(w));
}

/** Short phrases Whisper is known to invent over music, noise or foreign speech. */
const STOCK_PHRASES = [
  'thank you very much',
  'thank you so much',
  'merci beaucoup',
  'thank you',
  'bye bye',
  "i'm sorry",
  'goodbye',
  'thanks',
  'bye',
  'you',
  'merci',
  'amen',
  'gracias',
  'danke',
  'grazie',
  'obrigado',
  'hvala',
].map((p) => p.split(' '));

/** "Thank you.", "Thank you. Thank you.", "you Thank you." … (any repetition of stock phrases). */
export function isStockPhrase(text: string): boolean {
  const tokens = stripAnnotations(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;
  let i = 0;
  outer: while (i < tokens.length) {
    for (const p of STOCK_PHRASES) {
      if (p.every((w, k) => tokens[i + k] === w)) {
        i += p.length;
        continue outer;
      }
    }
    return false;
  }
  return true;
}

export interface FilterStats {
  nonSpeech: number;
  credits: number;
  stock: number;
  repeated: number;
  lowConfidence: number;
}

/**
 * Removes what nobody says: music/sound-tag-only segments, credit lines, low-confidence
 * non-speech, runs of ≥ 3 identical segments, and stock phrases ("Thank you.", "Bye.", "Merci.")
 * that are stretched over several seconds or appear in clusters (≥ 3 suspicious segments within
 * 15 s). Sound annotations are stripped from the kept text.
 */
export function filterHallucinations(segments: SttSegment[]): {
  kept: SttSegment[];
  dropped: number;
  stats: FilterStats;
} {
  const stats: FilterStats = { nonSpeech: 0, credits: 0, stock: 0, repeated: 0, lowConfidence: 0 };
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  type Mark = {
    seg: SttSegment;
    text: string;
    drop: keyof FilterStats | null;
    suspicious: boolean;
  };
  const marks: Mark[] = [];
  let runText = '';
  let runCount = 0;
  for (const seg of sorted) {
    const text = stripAnnotations(seg.text);
    const norm = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (norm === runText) runCount++;
    else {
      runText = norm;
      runCount = 1;
    }
    let drop: keyof FilterStats | null = null;
    if (isNonSpeech(seg.text)) drop = 'nonSpeech';
    else if (isFiller(text)) drop = 'credits';
    else if ((seg.noSpeechProb ?? 0) > 0.6 && (seg.avgLogprob ?? 0) < -1) drop = 'lowConfidence';
    // Two identical in a row are allowed ("No. No."), the third onwards is dropped.
    else if (runCount >= 3) drop = 'repeated';
    const stock = drop === null && isStockPhrase(text);
    marks.push({ seg, text, drop, suspicious: drop !== null || stock });
  }
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]!;
    if (m.drop || !isStockPhrase(m.text)) continue;
    const stretched = m.seg.end - m.seg.start > 3.5;
    let neighbours = 0;
    for (let j = 0; j < marks.length; j++) {
      if (j !== i && marks[j]!.suspicious && Math.abs(marks[j]!.seg.start - m.seg.start) <= 15)
        neighbours++;
    }
    if (stretched || neighbours >= 2) m.drop = 'stock';
  }
  const kept: SttSegment[] = [];
  for (const m of marks) {
    if (m.drop) stats[m.drop]++;
    else kept.push({ ...m.seg, text: m.text });
  }
  return { kept, dropped: marks.length - kept.length, stats };
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
  const { kept, dropped, stats } = filterHallucinations(allSegments);
  if (dropped > 0) {
    const parts = [
      stats.nonSpeech && `${stats.nonSpeech} music/sound-only`,
      stats.stock && `${stats.stock} invented stock phrases ("Thank you." …)`,
      stats.credits && `${stats.credits} credit lines`,
      stats.repeated && `${stats.repeated} repeats`,
      stats.lowConfidence && `${stats.lowConfidence} low-confidence`,
    ].filter(Boolean);
    o.log('info', `Removed ${dropped} segment(s) nobody says: ${parts.join(', ')}`);
  }
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
