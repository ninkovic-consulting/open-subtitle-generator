import type {
  ChatProvider,
  ChatRequest,
  ChatResult,
  SttProvider,
  SttRequest,
  SttResult,
} from '../../src/server/providers/types.js';

export interface FakeLog {
  stt: SttRequest[];
  chat: ChatRequest[];
}

/** Fake STT: one "spoken" segment per 6 s window (matches the generated tone fixture). */
export function fakeStt(
  log: FakeLog,
  opts: { seconds?: number; rejectWords?: boolean } = {},
): SttProvider {
  return {
    kind: 'openrouter',
    label: 'fake',
    async transcribe(req) {
      log.stt.push(req);
      if (opts.rejectWords && req.granularities.includes('word')) {
        const { ProviderError } = await import('../../src/server/providers/types.js');
        throw new ProviderError('word timestamps not supported', 400, false);
      }
      const seconds = opts.seconds ?? 30;
      const segments: SttResult['segments'] = [];
      const words: SttResult['words'] = [];
      for (let t = 0, n = 1; t + 4 <= seconds; t += 6, n++) {
        const text = `This is line number ${n}.`;
        segments.push({ start: t, end: t + 3.6, text, noSpeechProb: 0.01, avgLogprob: -0.2 });
        if (!opts.rejectWords && req.granularities.includes('word')) {
          const parts = ['this', 'is', 'line', 'number', String(n)];
          parts.forEach((w, i) =>
            words.push({ start: t + i * 0.7, end: t + i * 0.7 + 0.6, word: w }),
          );
        }
      }
      segments.push({
        start: seconds - 1,
        end: seconds - 0.2,
        text: 'Thanks for watching!',
        noSpeechProb: 0.9,
        avgLogprob: -1.5,
      });
      return {
        text: segments.map((s) => s.text).join(' '),
        language: 'en',
        duration: seconds,
        segments,
        words,
        costUsd: 0.001,
        model: req.model,
      };
    },
  };
}

function userPayload(req: ChatRequest): Record<string, unknown> {
  const msg = req.messages.find((m) => m.role === 'user')!;
  const text =
    typeof msg.content === 'string'
      ? msg.content
      : msg.content.find((p) => p.type === 'text')!.text;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Fake chat model: deterministic Croatian output with all special letters. */
export function fakeChat(
  log: FakeLog,
  opts: { dropIds?: Set<number>; supportsAudio?: boolean; failAlways?: boolean } = {},
): ChatProvider {
  return {
    kind: 'openrouter',
    label: 'fake',
    supportsAudio: opts.supportsAudio ?? true,
    supportsJsonSchema: true,
    async complete(req): Promise<ChatResult> {
      log.chat.push(req);
      const usage = {
        promptTokens: 1000,
        completionTokens: 200,
        audioTokens: 0,
        costUsd: 0.0005,
        model: req.model,
      };
      if (req.jsonSchema?.name === 'subtitle_context') {
        return {
          ...usage,
          content: JSON.stringify({
            characters: [{ name: 'Ana', gender: 'f', notes: 'lead' }],
            formality: [{ speaker: 'Ana', addressee: 'Marko', form: 'informal', notes: '' }],
            terms: [{ source: 'Harbor', target: 'Luka', notes: '' }],
            style_notes: 'casual',
          }),
        };
      }
      if (opts.failAlways) return { ...usage, content: 'not json' };
      const payload = userPayload(req);
      const cues = (payload.cues as { id: number; text: string }[]) ?? [];
      const items = cues
        .filter((c) => !opts.dropIds?.has(c.id))
        .map((c) => ({
          id: c.id,
          speaker_gender: c.id % 2 ? 'f' : 'm',
          text: `Rečenica čćđšž ${c.id}`,
        }));
      return { ...usage, content: '```json\n' + JSON.stringify({ items }) + '\n```' };
    },
  };
}
