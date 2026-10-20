import { describe, expect, it } from 'vitest';
import {
  buildCues,
  buildTimedTokens,
  finalizeTiming,
  groupTokens,
  lcsAlign,
} from '../src/server/services/cues.js';

describe('lcsAlign', () => {
  it('aligns normalised tokens', () => {
    expect(lcsAlign(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([
      [0, 0],
      [2, 2],
    ]);
  });
});

describe('buildTimedTokens', () => {
  it('takes punctuation from segments and times from words', () => {
    const tokens = buildTimedTokens(
      [{ start: 0, end: 2, text: 'Hello, world!' }],
      [
        { start: 0.1, end: 0.5, word: 'hello' },
        { start: 0.9, end: 1.6, word: 'world' },
      ],
    );
    expect(tokens.map((t) => t.text)).toEqual(['Hello,', 'world!']);
    expect(tokens[0]!.start).toBeCloseTo(0.1);
    expect(tokens[1]!.end).toBeCloseTo(1.6);
  });
  it('interpolates unmatched tokens between anchors', () => {
    const tokens = buildTimedTokens(
      [{ start: 0, end: 3, text: 'One two three four' }],
      [
        { start: 0, end: 0.5, word: 'one' },
        { start: 2.5, end: 3, word: 'four' },
      ],
    );
    expect(tokens[1]!.start).toBeGreaterThanOrEqual(0.5);
    expect(tokens[2]!.end).toBeLessThanOrEqual(2.5 + 1e-9);
  });
  it('distributes time by characters when there are no words', () => {
    const tokens = buildTimedTokens([{ start: 10, end: 12, text: 'aa bbbbbb' }], []);
    expect(tokens[0]!.start).toBe(10);
    expect(tokens[1]!.end).toBeCloseTo(12);
    expect(tokens[0]!.end - tokens[0]!.start).toBeLessThan(tokens[1]!.end - tokens[1]!.start);
  });
  it('handles CJK without spaces', () => {
    const tokens = buildTimedTokens([{ start: 0, end: 4, text: 'こんにちは。元気ですか？' }], []);
    expect(tokens.map((t) => t.joiner)).toEqual(['', '']);
    expect(tokens).toHaveLength(2);
  });
});

describe('groupTokens', () => {
  const tok = (text: string, start: number, end: number) => ({ text, start, end, joiner: ' ' });
  it('breaks on long gaps', () => {
    const groups = groupTokens([tok('Hi', 0, 0.3), tok('there', 0.4, 0.8), tok('Later', 3, 3.4)]);
    expect(groups).toHaveLength(2);
  });
  it('respects the 84 character limit and 6.5 s duration', () => {
    const words = Array.from({ length: 40 }, (_, i) => tok(`word${i}`, i * 0.3, i * 0.3 + 0.25));
    const groups = groupTokens(words);
    for (const g of groups) {
      const text = g.map((t) => t.text).join(' ');
      expect(text.length).toBeLessThanOrEqual(84);
      expect(g[g.length - 1]!.end - g[0]!.start).toBeLessThanOrEqual(6.5);
    }
  });
  it('prefers to break after a sentence end', () => {
    const words =
      'This is the first sentence of the monologue right here. And then another one follows'
        .split(' ')
        .map((w, i) => tok(w, i * 0.35, i * 0.35 + 0.3));
    const groups = groupTokens(words);
    expect(groups[0]!.at(-1)!.text).toBe('here.');
  });
});

describe('finalizeTiming', () => {
  it('adds linger, enforces min duration and never overlaps', () => {
    const out = finalizeTiming([
      { startMs: 0, endMs: 300, text: 'a' },
      { startMs: 700, endMs: 2000, text: 'b' },
      { startMs: 2050, endMs: 3000, text: 'c' },
    ]);
    expect(out[0]!.endMs).toBe(620); // capped at next start - 80 ms
    for (let i = 1; i < out.length; i++) expect(out[i]!.startMs).toBeGreaterThan(out[i - 1]!.endMs);
    expect(out[2]!.endMs).toBe(3250);
  });
});

describe('buildCues', () => {
  it('produces monotonic, wrapped cues', () => {
    const segments = Array.from({ length: 10 }, (_, i) => ({
      start: i * 3,
      end: i * 3 + 2.5,
      text: `Sentence number ${i + 1} is spoken here.`,
    }));
    const cues = buildCues(segments, [], 30);
    expect(cues.length).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < cues.length; i++) {
      expect(cues[i]!.endMs).toBeGreaterThan(cues[i]!.startMs);
      if (i) expect(cues[i]!.startMs).toBeGreaterThanOrEqual(cues[i - 1]!.endMs);
      for (const line of cues[i]!.text.split('\n')) expect(line.length).toBeLessThanOrEqual(42);
    }
  });
});
