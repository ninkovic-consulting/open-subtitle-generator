import type { SttSegment, SttWord } from '../providers/types.js';
import { isCjk, normalizeText, wrapText, type SrtCue } from './srt.js';

export const CUE_RULES = {
  maxChars: 84,
  maxDurationSec: 6.5,
  minDurationSec: 1.0,
  gapBreakSec: 0.8,
  lingerSec: 0.25,
  minGapSec: 0.08,
  commaBreakChars: 50,
  sentenceBreakChars: 40,
};

export interface TimedToken {
  text: string;
  start: number;
  end: number;
  /** String inserted before this token when joining (`' '` for most scripts, `''` for CJK). */
  joiner: string;
}

const PUNCT_RE = /[\p{P}\p{S}]/gu;

export function normalizeToken(t: string): string {
  return t.normalize('NFKC').toLowerCase().replace(PUNCT_RE, '').trim();
}

/** Longest common subsequence over normalised tokens; returns index pairs [tokenIdx, wordIdx]. */
export function lcsAlign(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j] && a[i] !== ''
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j] && a[i] !== '') {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function splitCjk(text: string): string[] {
  // Split after CJK sentence/clause punctuation, keeping it attached.
  return text
    .split(/(?<=[。！？、，,.!?…])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Distributes [start, end] over tokens proportionally to character count. */
function distribute(tokens: string[], start: number, end: number, joiner: string): TimedToken[] {
  const total = tokens.reduce((s, t) => s + Math.max(1, t.length), 0) || 1;
  const span = Math.max(0, end - start);
  let t = start;
  return tokens.map((tok) => {
    const d = (span * Math.max(1, tok.length)) / total;
    const token = { text: tok, start: t, end: t + d, joiner };
    t += d;
    return token;
  });
}

/**
 * Builds punctuated, timed tokens. Whisper `words` carry precise times but often no punctuation,
 * while segment text is punctuated; align them with LCS and interpolate unmatched tokens.
 */
export function buildTimedTokens(segments: SttSegment[], words: SttWord[]): TimedToken[] {
  const out: TimedToken[] = [];
  const sortedWords = [...words].filter((w) => w.word.trim()).sort((a, b) => a.start - b.start);
  let wi = 0;
  for (const seg of segments) {
    const text = normalizeText(seg.text).replace(/\n/g, ' ');
    if (!text) continue;
    const cjk = isCjk(text) && !/\s/.test(text.trim());
    const joiner = cjk ? '' : ' ';
    const tokens = cjk ? splitCjk(text) : text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    // Words belonging to this segment (by midpoint).
    const segWords: SttWord[] = [];
    while (
      wi < sortedWords.length &&
      (sortedWords[wi]!.start + sortedWords[wi]!.end) / 2 < seg.start - 0.05
    )
      wi++;
    let k = wi;
    while (
      k < sortedWords.length &&
      (sortedWords[k]!.start + sortedWords[k]!.end) / 2 <= seg.end + 0.05
    ) {
      segWords.push(sortedWords[k]!);
      k++;
    }
    wi = k;

    if (cjk || segWords.length === 0) {
      out.push(...distribute(tokens, seg.start, seg.end, joiner));
      continue;
    }

    const pairs = lcsAlign(
      tokens.map(normalizeToken),
      segWords.map((w) => normalizeToken(w.word)),
    );
    const starts: (number | null)[] = tokens.map(() => null);
    const ends: (number | null)[] = tokens.map(() => null);
    for (const [ti, wj] of pairs) {
      starts[ti] = segWords[wj]!.start;
      ends[ti] = segWords[wj]!.end;
    }
    // Interpolate gaps between anchors (segment bounds act as outer anchors).
    let i = 0;
    while (i < tokens.length) {
      if (starts[i] !== null) {
        i++;
        continue;
      }
      let j = i;
      while (j < tokens.length && starts[j] === null) j++;
      const from = i === 0 ? seg.start : (ends[i - 1] ?? seg.start);
      const to = j >= tokens.length ? Math.max(from, seg.end) : (starts[j] ?? seg.end);
      const filled = distribute(tokens.slice(i, j), from, Math.max(from, to), joiner);
      filled.forEach((f, n) => {
        starts[i + n] = f.start;
        ends[i + n] = f.end;
      });
      i = j;
    }
    tokens.forEach((tok, n) => {
      const s = starts[n] ?? seg.start;
      out.push({ text: tok, start: s, end: Math.max(s, ends[n] ?? s), joiner });
    });
  }
  return out;
}

function joinTokens(tokens: TimedToken[]): string {
  return tokens.map((t, i) => (i === 0 ? t.text : t.joiner + t.text)).join('');
}

const SENTENCE_END = /[.?!…。！？]["'»”’)]*$/u;
const CLAUSE_END = /[,;:，、]["'»”’)]*$/u;

/** Groups timed tokens into subtitle cues following the readability rules. */
export function groupTokens(tokens: TimedToken[], rules = CUE_RULES): TimedToken[][] {
  const groups: TimedToken[][] = [];
  let cur: TimedToken[] = [];

  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (cur.length) {
      const prev = cur[cur.length - 1]!;
      const gap = tok.start - prev.end;
      const projectedLen = joinTokens([...cur, tok]).length;
      const projectedDur = tok.end - cur[0]!.start;
      if (gap > rules.gapBreakSec) {
        flush();
      } else if (projectedLen > rules.maxChars || projectedDur > rules.maxDurationSec) {
        // Back-track to the last sentence/clause boundary if it keeps a reasonable first part.
        let cut = -1;
        for (let k = cur.length - 1; k > 0; k--) {
          const left = joinTokens(cur.slice(0, k + 1)).length;
          if (left < rules.maxChars * 0.35) break;
          if (SENTENCE_END.test(cur[k]!.text)) {
            cut = k;
            break;
          }
          if (cut === -1 && CLAUSE_END.test(cur[k]!.text)) cut = k;
        }
        if (cut > 0 && cut < cur.length - 1) {
          const rest = cur.slice(cut + 1);
          cur = cur.slice(0, cut + 1);
          flush();
          cur = rest;
        } else {
          flush();
        }
      }
    }
    cur.push(tok);

    const text = joinTokens(cur);
    const next = tokens[i + 1];
    if (SENTENCE_END.test(tok.text)) {
      const pause = next ? next.start - tok.end : Infinity;
      if (text.length >= rules.sentenceBreakChars || pause > 0.3) flush();
    } else if (CLAUSE_END.test(tok.text) && text.length > rules.commaBreakChars) {
      flush();
    }
  }
  flush();
  return groups;
}

/** Final timing: linger, minimum duration, no overlaps, minimum gap. */
export function finalizeTiming(cues: SrtCue[], durationSec?: number, rules = CUE_RULES): SrtCue[] {
  const out = cues.map((c) => ({ ...c }));
  const minGap = rules.minGapSec * 1000;
  const maxEnd = durationSec ? durationSec * 1000 : Number.POSITIVE_INFINITY;
  for (let i = 0; i < out.length; i++) {
    const c = out[i]!;
    const next = out[i + 1];
    const limit = Math.min(next ? next.startMs - minGap : maxEnd, maxEnd);
    let end = c.endMs + rules.lingerSec * 1000;
    if (end - c.startMs < rules.minDurationSec * 1000)
      end = c.startMs + rules.minDurationSec * 1000;
    end = Math.min(end, limit);
    if (end <= c.startMs) end = Math.min(c.startMs + 200, next ? next.startMs : c.startMs + 200);
    c.endMs = Math.round(end);
    c.startMs = Math.round(c.startMs);
  }
  return out;
}

/** Segments + words from STT → final subtitle cues. */
export function buildCues(
  segments: SttSegment[],
  words: SttWord[],
  durationSec?: number,
): SrtCue[] {
  const tokens = buildTimedTokens(segments, words);
  const groups = groupTokens(tokens);
  const raw = groups.map((g) => ({
    startMs: g[0]!.start * 1000,
    endMs: g[g.length - 1]!.end * 1000,
    text: wrapText(joinTokens(g)),
  }));
  return finalizeTiming(
    raw.filter((c) => c.text),
    durationSec,
  );
}
