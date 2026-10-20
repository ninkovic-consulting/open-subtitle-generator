import { describe, expect, it } from 'vitest';
import { EMPTY_GLOSSARY } from '../src/shared/types.js';
import { ProviderError, type ChatProvider } from '../src/server/providers/types.js';
import { mergeGlossary } from '../src/server/services/context.js';
import { parseModelJson } from '../src/server/services/json.js';
import { translateCues, validateBatch, type SourceCue } from '../src/server/services/translate.js';
import { fakeChat, type FakeLog } from './helpers/fakes.js';

const cues: SourceCue[] = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  startMs: i * 2000,
  endMs: i * 2000 + 1500,
  text: `Line ${i + 1}`,
}));
const base = {
  all: cues,
  targetLanguage: 'Croatian',
  glossary: EMPTY_GLOSSARY,
  model: 'm',
  batchSize: 4,
  concurrency: 2,
  useAudio: false,
  reasoningEffort: 'minimal' as const,
  temperature: 0.3,
  log: () => undefined,
  onCall: () => undefined,
};

describe('parseModelJson', () => {
  it('handles fences and prose', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('Here you go: {"a":2} hope it helps')).toEqual({ a: 2 });
    expect(() => parseModelJson('nothing')).toThrow();
  });
});

describe('validateBatch', () => {
  it('accepts exact ids and reports missing, empty and too-long items', () => {
    const batch = cues.slice(0, 4);
    const r = validateBatch(batch, {
      items: [
        { id: 1, speaker_gender: 'f', text: 'Jedan' },
        { id: 2, speaker_gender: 'm', text: '' },
        { id: 3, speaker_gender: 'x', text: 'x'.repeat(200) },
        { id: 99, speaker_gender: 'm', text: 'stray' },
      ],
    });
    expect([...r.valid.keys()]).toEqual([1]);
    expect(r.valid.get(1)!.gender).toBe('f');
    expect(r.invalid.sort()).toEqual([2, 3, 4]);
  });
});

describe('translateCues', () => {
  it('translates every cue in batches', async () => {
    const log: FakeLog = { stt: [], chat: [] };
    const out = await translateCues({ ...base, chat: fakeChat(log) });
    expect(out.size).toBe(10);
    expect(out.get(3)!.text).toBe('Rečenica čćđšž 3');
    expect(log.chat).toHaveLength(3);
  });

  it('retries only the missing ids', async () => {
    const log: FakeLog = { stt: [], chat: [] };
    let first = true;
    const chat = fakeChat(log);
    const flaky: ChatProvider = {
      ...chat,
      async complete(req) {
        const res = await chat.complete(req);
        if (first) {
          first = false;
          const parsed = parseModelJson(res.content) as { items: { id: number }[] };
          return { ...res, content: JSON.stringify({ items: parsed.items.slice(1) }) };
        }
        return res;
      },
    };
    const out = await translateCues({ ...base, concurrency: 1, chat: flaky });
    expect(out.size).toBe(10);
    expect([...out.values()].every((v) => !v.fallback)).toBe(true);
  });

  it('splits, then keeps the source text as a last resort', async () => {
    const log: FakeLog = { stt: [], chat: [] };
    const out = await translateCues({
      ...base,
      targets: cues.slice(0, 2),
      chat: fakeChat(log, { failAlways: true }),
    });
    expect(out.size).toBe(2);
    expect(out.get(1)).toMatchObject({ text: 'Line 1', fallback: true });
    // 3 attempts on the batch, then 3 for each half
    expect(log.chat.length).toBe(9);
  });

  it('drops audio when the model rejects it', async () => {
    const log: FakeLog = { stt: [], chat: [] };
    const chat = fakeChat(log);
    const noAudio: ChatProvider = {
      ...chat,
      async complete(req) {
        const hasAudio = req.messages.some(
          (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'audio'),
        );
        if (hasAudio)
          throw new ProviderError('This model does not support audio input', 400, false);
        return chat.complete(req);
      },
    };
    const out = await translateCues({
      ...base,
      chat: noAudio,
      useAudio: true,
      loadAudio: async () => Buffer.from('mp3'),
    });
    expect(out.size).toBe(10);
  });

  it('fails fast on a bad API key', async () => {
    const chat: ChatProvider = {
      ...fakeChat({ stt: [], chat: [] }),
      complete: async () => {
        throw new ProviderError('bad key', 401, false);
      },
    };
    await expect(translateCues({ ...base, chat })).rejects.toThrow('bad key');
  });
});

describe('mergeGlossary', () => {
  it('keeps user edits and adds new entries', () => {
    const merged = mergeGlossary(
      {
        characters: [{ name: 'Ana', gender: 'u', notes: 'edited by user' }],
        formality: [],
        terms: [{ source: 'Harbor', target: 'Lučica', notes: '' }],
        styleNotes: '',
      },
      {
        characters: [
          { name: 'ana', gender: 'f', notes: 'x' },
          { name: 'Marko', gender: 'm', notes: '' },
        ],
        formality: [],
        terms: [{ source: 'harbor', target: 'Luka', notes: '' }],
        styleNotes: 'casual',
      },
    );
    expect(merged.characters).toEqual([
      { name: 'Ana', gender: 'f', notes: 'edited by user' },
      { name: 'Marko', gender: 'm', notes: '' },
    ]);
    expect(merged.terms).toEqual([{ source: 'Harbor', target: 'Lučica', notes: '' }]);
    expect(merged.styleNotes).toBe('casual');
  });
});

describe('audio verification of speech-to-text lines', () => {
  const batch = [
    { id: 1, startMs: 0, endMs: 1000, text: 'Thank you.' },
    {
      id: 2,
      startMs: 2000,
      endMs: 5000,
      text: 'I was at the harbor all morning with your father, you know that.',
    },
  ];
  const answer = {
    items: [
      { id: 1, spoken: false, speaker_gender: 'u', text: '' },
      {
        id: 2,
        spoken: false,
        speaker_gender: 'm',
        text: 'Cijelo jutro sam bio u luci s tvojim ocem, znaš to.',
      },
    ],
  };

  it('removes short lines the model cannot hear, never long ones', () => {
    const r = validateBatch(batch, answer, { verifySpeech: true });
    expect(r.valid.get(1)).toMatchObject({ removed: true, text: '' });
    expect(r.valid.get(2)).toMatchObject({
      text: 'Cijelo jutro sam bio u luci s tvojim ocem, znaš to.',
    });
    expect(r.valid.get(2)!.removed).toBeUndefined();
  });

  it('ignores "spoken: false" when timing comes from real subtitles', () => {
    const r = validateBatch(batch, answer, { verifySpeech: false });
    expect(r.valid.has(1)).toBe(false); // empty text is invalid → retried
    expect(r.invalid).toEqual([1]);
  });

  it('asks the model to verify only when audio is attached', async () => {
    const log: FakeLog = { stt: [], chat: [] };
    await translateCues({ ...base, chat: fakeChat(log), verifySpeech: true, useAudio: false });
    expect(log.chat[0]!.messages[0]!.content).toContain('Always set spoken=true');
    const log2: FakeLog = { stt: [], chat: [] };
    await translateCues({
      ...base,
      chat: fakeChat(log2),
      verifySpeech: true,
      useAudio: true,
      loadAudio: async () => Buffer.from('mp3'),
    });
    expect(log2.chat[0]!.messages[0]!.content).toContain('set spoken=false');
  });
});
