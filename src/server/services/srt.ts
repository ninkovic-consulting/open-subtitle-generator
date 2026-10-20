import iconv from 'iconv-lite';
import jschardet from 'jschardet';
import { findLanguage } from '../../shared/languages.js';
import type { OutputEncoding } from '../../shared/types.js';

export interface SrtCue {
  startMs: number;
  endMs: number;
  text: string;
}

export const MAX_LINE = 42;
export const MAX_LINES = 2;

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

const TS_RE = /(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?/;

/** `00:01:02,345` / `01:02.5` / `1:02:03` → milliseconds. Returns NaN when unparseable. */
export function parseTimestamp(value: string): number {
  const m = TS_RE.exec(value.trim());
  if (!m) return Number.NaN;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  const s = Number(m[3]);
  const frac = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return ((h * 60 + min) * 60 + s) * 1000 + frac;
}

/** Milliseconds → `HH:MM:SS,mmm`. */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const f = total % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(f, 3)}`;
}

/** Milliseconds → `HH:MM:SS.mmm` (WebVTT). */
export function formatVttTimestamp(ms: number): string {
  return formatTimestamp(ms).replace(',', '.');
}

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------

// Zero-width characters, BOM, bidi marks that break old players, and C0/C1 control chars (except \n).
// eslint-disable-next-line no-control-regex
const INVISIBLE_RE = /[\u200B-\u200D\u2060\uFEFF\u00AD]|[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/** NFC-normalises (č as one code point), strips invisible/control chars and tidies whitespace. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE_RE, '')
    .split('\n')
    .map((l) => l.replace(/ {2,}/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

/** Removes ASS/SSA override blocks (`{\an8}`) and converts `\N` line breaks. */
export function stripAssTags(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\\N/gi, '\n')
    .replace(/\\h/g, ' ');
}

export function visibleLength(text: string): number {
  return text.replace(/<[^>]+>/g, '').length;
}

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/;

export function isCjk(text: string): boolean {
  return CJK_RE.test(text);
}

function isDialogue(lines: string[]): boolean {
  return lines.length >= 2 && lines.every((l) => /^(<[^>]+>)*\s*[-–—]/.test(l));
}

/**
 * Wraps a cue into at most two balanced lines of ≤ 42 visible characters.
 * Dialogue-dash lines and already-short multi-line cues are kept as they are.
 */
export function wrapText(text: string, maxLine = MAX_LINE): string {
  const clean = normalizeText(text);
  if (!clean) return '';
  const lines = clean.split('\n');
  if (isDialogue(lines)) return lines.join('\n');
  if (lines.length <= MAX_LINES && lines.every((l) => visibleLength(l) <= maxLine)) {
    return lines.join('\n');
  }
  const single = lines.join(' ').replace(/ {2,}/g, ' ');
  if (visibleLength(single) <= maxLine) return single;

  // Candidate break positions: spaces outside of tags.
  const candidates: number[] = [];
  let inTag = false;
  for (let i = 0; i < single.length; i++) {
    const ch = single[i];
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (ch === ' ' && !inTag) candidates.push(i);
  }

  if (candidates.length === 0) {
    // CJK or one long token: split at the visual midpoint.
    if (isCjk(single)) {
      const mid = Math.ceil(single.length / 2);
      return `${single.slice(0, mid)}\n${single.slice(mid)}`;
    }
    return single;
  }

  const total = visibleLength(single);
  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const pos of candidates) {
    const left = single.slice(0, pos);
    const right = single.slice(pos + 1);
    const l = visibleLength(left);
    const r = visibleLength(right);
    let score = Math.abs(l - r);
    if (Math.max(l, r) > maxLine) score += 1000 + Math.max(l, r);
    const prev = left.replace(/<[^>]+>$/g, '').slice(-1);
    if ('.?!…'.includes(prev)) score -= 12;
    else if (',;:'.includes(prev)) score -= 6;
    // Avoid leaving a short function word dangling at the end of line one.
    const lastWord = left.split(' ').pop() ?? '';
    if (lastWord.length <= 2 && total > 20) score += 4;
    if (score < bestScore) {
      bestScore = score;
      best = pos;
    }
  }
  return `${single.slice(0, best)}\n${single.slice(best + 1)}`;
}

// ---------------------------------------------------------------------------
// Parse / render
// ---------------------------------------------------------------------------

const ARROW_RE =
  /^\s*((?:\d{1,3}:)?\d{1,2}:\d{1,2}(?:[,.]\d{1,3})?)\s*-->\s*((?:\d{1,3}:)?\d{1,2}:\d{1,2}(?:[,.]\d{1,3})?)/;

/** Tolerant SRT parser (handles missing indices, `.` decimals, extra blank lines, position tags). */
export function parseSrt(input: string): SrtCue[] {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const cues: SrtCue[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = ARROW_RE.exec(lines[i] ?? '');
    if (!m) {
      i++;
      continue;
    }
    const startMs = parseTimestamp(m[1]!);
    const endMs = parseTimestamp(m[2]!);
    i++;
    const body: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '') {
      // A new cue may start without a blank line in sloppy files.
      if (ARROW_RE.test(lines[i]!)) break;
      if (/^\d+$/.test(lines[i]!.trim()) && ARROW_RE.test(lines[i + 1] ?? '')) break;
      body.push(lines[i]!);
      i++;
    }
    const cueText = normalizeText(stripAssTags(body.join('\n')));
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && cueText) {
      cues.push({ startMs, endMs: Math.max(endMs, startMs), text: cueText });
    }
  }
  cues.sort((a, b) => a.startMs - b.startMs);
  return cues;
}

/** Renders cues as SRT with CRLF line endings (what TVs and Windows players expect). */
export function renderSrt(cues: SrtCue[], { wrap = true }: { wrap?: boolean } = {}): string {
  const out: string[] = [];
  let n = 1;
  for (const cue of cues) {
    const text = wrap ? wrapText(cue.text) : normalizeText(cue.text);
    if (!text) continue;
    out.push(
      String(n++),
      `${formatTimestamp(cue.startMs)} --> ${formatTimestamp(cue.endMs)}`,
      ...text.split('\n'),
      '',
    );
  }
  return out.join('\r\n');
}

export function renderVtt(cues: SrtCue[]): string {
  const out = ['WEBVTT', ''];
  for (const cue of cues) {
    const text = wrapText(cue.text);
    if (!text) continue;
    out.push(`${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}`, text, '');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export interface EncodedSubtitle {
  buffer: Buffer;
  /** Encoding actually written, e.g. `utf-8-bom`, `utf-8`, `cp1250`. */
  encoding: string;
  /** True when legacy was requested but characters did not fit and UTF-8+BOM was used. */
  fellBack: boolean;
}

/** Legacy Windows code page for a target language (`hr` → `cp1250`), or null. */
export function legacyCodepageFor(language: string): string | null {
  return findLanguage(language)?.codepage ?? null;
}

function utf8Bom(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
}

/**
 * Encodes subtitle text. With `legacy`, uses the language's code page via iconv-lite and verifies a
 * lossless round-trip; any unencodable character falls back to UTF-8 with BOM (never writes `?`).
 */
export function encodeSubtitle(
  text: string,
  encoding: OutputEncoding,
  language: string,
): EncodedSubtitle {
  const nfc = text.normalize('NFC');
  if (encoding === 'utf8')
    return { buffer: Buffer.from(nfc, 'utf8'), encoding: 'utf-8', fellBack: false };
  if (encoding === 'legacy') {
    const cp = legacyCodepageFor(language);
    if (cp && iconv.encodingExists(cp)) {
      const buf = iconv.encode(nfc, cp);
      if (iconv.decode(buf, cp) === nfc) return { buffer: buf, encoding: cp, fellBack: false };
    }
    return { buffer: utf8Bom(nfc), encoding: 'utf-8-bom', fellBack: true };
  }
  return { buffer: utf8Bom(nfc), encoding: 'utf-8-bom', fellBack: false };
}

export interface DecodedSubtitle {
  text: string;
  encoding: string;
}

/**
 * Decodes an existing subtitle file: BOM / UTF-16 → strict UTF-8 → charset detection → cp1250
 * (the most common legacy encoding for BCS subtitles).
 */
export function decodeSubtitle(buf: Buffer): DecodedSubtitle {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'utf-8-bom' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: iconv.decode(buf.subarray(2), 'utf-16le'), encoding: 'utf-16le' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: iconv.decode(buf.subarray(2), 'utf-16be'), encoding: 'utf-16be' };
  }
  // UTF-16 without BOM: lots of NUL bytes in odd/even positions.
  const sample = buf.subarray(0, 2000);
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      if (i % 2 === 0) evenNul++;
      else oddNul++;
    }
  }
  if (oddNul > sample.length / 4)
    return { text: iconv.decode(buf, 'utf-16le'), encoding: 'utf-16le' };
  if (evenNul > sample.length / 4)
    return { text: iconv.decode(buf, 'utf-16be'), encoding: 'utf-16be' };

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text, encoding: 'utf-8' };
  } catch {
    // not valid UTF-8
  }
  const detected = jschardet.detect(buf);
  const name = detected?.encoding?.toLowerCase().replace('windows-', 'cp');
  if (name && detected.confidence > 0.6 && iconv.encodingExists(name) && name !== 'ascii') {
    // jschardet often confuses cp1250 with cp1252/ISO-8859-1; prefer cp1250 when the result has
    // characters typical of mis-decoded Croatian (è, æ, ð, š in odd places).
    const text = iconv.decode(buf, name);
    if (!/(cp1252|iso-8859-1)/.test(name) || !/[èæð]/i.test(text)) return { text, encoding: name };
  }
  return { text: iconv.decode(buf, 'cp1250'), encoding: 'cp1250' };
}
