import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STT_MODEL,
  DEFAULT_TRANSLATE_MODEL,
  EMPTY_GLOSSARY,
} from '../../src/shared/types.js';
import {
  OpenRouterChat,
  OpenRouterStt,
  createOpenRouterClient,
} from '../../src/server/providers/openrouter.js';
import { FFMPEG, run } from '../../src/server/services/media.js';
import { translateCues } from '../../src/server/services/translate.js';

const envFile = path.resolve('.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const key = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API || '';

describe.skipIf(!key)('OpenRouter (live)', () => {
  const client = createOpenRouterClient(key);

  it('transcribes with word + segment timestamps', async () => {
    const { stdout } = await run(FFMPEG, [
      '-nostdin',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=300:duration=2',
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
    ]);
    const res = await new OpenRouterStt(client).transcribe({
      audio: stdout,
      format: 'mp3',
      model: DEFAULT_STT_MODEL,
      granularities: ['word', 'segment'],
    });
    expect(res.model).toBe(DEFAULT_STT_MODEL);
    expect(Array.isArray(res.segments)).toBe(true);
  });

  it('translates into Croatian with the right grammatical gender', async () => {
    const cues = [
      { id: 1, startMs: 0, endMs: 2500, text: 'ANNA: I was ready an hour ago.' },
      { id: 2, startMs: 3000, endMs: 5500, text: 'MARKO: I was at the harbor all morning.' },
      { id: 3, startMs: 6000, endMs: 8000, text: 'ANNA: Thank you for waiting for me, Marko.' },
    ];
    const out = await translateCues({
      all: cues,
      targetLanguage: 'Croatian',
      glossary: {
        ...EMPTY_GLOSSARY,
        characters: [
          { name: 'Anna', gender: 'f', notes: '' },
          { name: 'Marko', gender: 'm', notes: '' },
        ],
      },
      chat: new OpenRouterChat(client),
      model: DEFAULT_TRANSLATE_MODEL,
      batchSize: 10,
      concurrency: 1,
      useAudio: false,
      reasoningEffort: 'minimal',
      temperature: 0.2,
      log: () => undefined,
      onCall: (c) => expect(c.ok).toBe(true),
    });
    expect(out.size).toBe(3);
    expect(out.get(1)!.text).toMatch(/bila/i);
    expect(out.get(2)!.text).toMatch(/bio/i);
    expect(out.get(3)!.text).toMatch(/čeka/i);
  });
});
