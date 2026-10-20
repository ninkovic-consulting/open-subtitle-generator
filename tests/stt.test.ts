import { describe, expect, it } from 'vitest';
import { ProviderError, type SttProvider } from '../src/server/providers/types.js';
import {
  filterHallucinations,
  isFiller,
  majorityLanguage,
  transcribeChunks,
} from '../src/server/services/stt.js';

describe('hallucination filter', () => {
  it('drops low-confidence non-speech, filler phrases and repeated runs', () => {
    const seg = (text: string, extra: object = {}) => ({ start: 0, end: 1, text, ...extra });
    const { kept, dropped } = filterHallucinations([
      seg('Real line.'),
      seg('Hmm', { noSpeechProb: 0.8, avgLogprob: -1.4 }),
      seg('Thanks for watching!'),
      seg('Subtitles by the Amara.org community'),
      seg('No.'),
      seg('No.'),
      seg('No.'),
      seg('No.'),
      seg('Another real line.'),
    ]);
    expect(kept.map((k) => k.text)).toEqual(['Real line.', 'No.', 'No.', 'Another real line.']);
    expect(dropped).toBe(5);
  });
  it('recognises Croatian credit lines', () => {
    expect(isFiller('Hvala što ste gledali!')).toBe(true);
    expect(isFiller('Hvala ti.')).toBe(false);
  });
});

describe('majorityLanguage', () => {
  it('weights by chunk duration', () => {
    expect(majorityLanguage(['en', 'hr', 'en'], [100, 500, 100])).toBe('hr');
    expect(majorityLanguage([undefined, undefined])).toBeNull();
  });
});

describe('transcribeChunks', () => {
  const chunks = [
    { index: 0, start: 0, end: 600 },
    { index: 1, start: 600, end: 1200 },
  ];
  const noop = () => undefined;

  it('offsets timestamps by the chunk start and retries without word timestamps on 400', async () => {
    const calls: string[][] = [];
    const provider: SttProvider = {
      kind: 'openrouter',
      label: 'x',
      async transcribe(req) {
        calls.push(req.granularities);
        if (req.granularities.includes('word')) throw new ProviderError('no words', 400, false);
        return {
          text: 'hi',
          language: 'en',
          segments: [{ start: 1, end: 2, text: 'Hello there.' }],
          words: [],
          costUsd: 0.01,
          model: req.model,
        };
      },
    };
    const res = await transcribeChunks({
      chunks,
      loadChunk: async () => Buffer.from('x'),
      provider,
      model: 'm',
      concurrency: 2,
      log: noop,
      onCall: noop,
    });
    expect(res.segments.map((s) => s.start)).toEqual([1, 601]);
    expect(res.detectedLang).toBe('en');
    expect(calls.filter((g) => g.includes('word')).length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((g) => !g.includes('word')).length).toBe(2);
  });

  it('uses the fallback model when the primary fails', async () => {
    const used: string[] = [];
    const provider: SttProvider = {
      kind: 'openrouter',
      label: 'x',
      async transcribe(req) {
        used.push(req.model);
        if (req.model === 'primary') throw new ProviderError('down', 503, true);
        return {
          text: 'ok',
          segments: [{ start: 0, end: 1, text: 'Okay.' }],
          words: [],
          costUsd: null,
          model: req.model,
        };
      },
    };
    const res = await transcribeChunks({
      chunks: [chunks[0]!],
      loadChunk: async () => Buffer.alloc(1),
      provider,
      model: 'primary',
      fallbackModel: 'backup',
      concurrency: 1,
      log: noop,
      onCall: noop,
    });
    expect(used).toEqual(['primary', 'backup']);
    expect(res.segments).toHaveLength(1);
  });
});

describe('dialogue-only filter', () => {
  const seg = (start: number, end: number, text: string) => ({ start, end, text });

  it('strips sound annotations and detects non-speech', async () => {
    const { stripAnnotations, isNonSpeech } = await import('../src/server/services/stt.js');
    expect(stripAnnotations('*Dramatic music* I said move. ♪')).toBe('I said move.');
    expect(stripAnnotations('- - Yeah.')).toBe('- Yeah.');
    for (const t of [
      '♪♪',
      '♪ ♪',
      '- - -',
      '*Screaming*',
      '[Train passing]',
      'SIGHS',
      'Sigh.',
      '(laughs)',
    ]) {
      expect(isNonSpeech(t), t).toBe(true);
    }
    for (const t of ['Help!', 'You sick fuck.', '- Okay.']) expect(isNonSpeech(t), t).toBe(false);
  });

  it('recognises stock phrases and their repetitions', async () => {
    const { isStockPhrase } = await import('../src/server/services/stt.js');
    for (const t of [
      'Thank you.',
      'Thank you. Thank you.',
      'you Thank you.',
      'Merci.',
      '♪ Thank you.',
      'Bye.',
    ]) {
      expect(isStockPhrase(t), t).toBe(true);
    }
    for (const t of ['Thank you, Laurent.', 'No, thank you.', 'Goodbye, my friend.']) {
      expect(isStockPhrase(t), t).toBe(false);
    }
  });

  it('drops clusters of stock phrases over music but keeps an isolated real "Thank you."', () => {
    const { kept, stats } = filterHallucinations([
      seg(0, 10.6, 'Thanks for watching.'),
      seg(15.7, 21.2, '*Dramatic music*'),
      seg(22.3, 23.2, 'Thank you.'),
      seg(26.4, 27.4, 'Thank you.'),
      seg(28.1, 28.3, 'Bye.'),
      seg(37.4, 49.3, '♪ ♪'),
      seg(60, 62, 'Where were you this morning?'),
      seg(62.5, 63.4, 'Thank you.'),
      seg(90, 92, 'Sous-titrage Société Radio-Canada'),
      seg(120, 121, 'Thank you.'),
      seg(140, 150, 'Thank you.'),
    ]);
    expect(kept.map((k) => k.text)).toEqual(
      ['Where were you this morning?', 'Thank you.', 'Thank you.']
        .slice(0, 2)
        .concat(['Thank you.']),
    );
    expect(kept.map((k) => k.start)).toEqual([60, 62.5, 120]);
    expect(stats.nonSpeech).toBe(2);
    expect(stats.credits).toBe(2);
    expect(stats.stock).toBe(4); // three in the cluster + one stretched over 10 s
  });
});
