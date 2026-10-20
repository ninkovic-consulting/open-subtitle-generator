import type { Gender, Glossary, ReasoningEffort } from '../../shared/types.js';
import {
  ProviderError,
  isAbortError,
  type ChatPart,
  type ChatProvider,
} from '../providers/types.js';
import { parseModelJson } from './json.js';
import type { JobLogger } from './joblog.js';
import { normalizeText, visibleLength } from './srt.js';
import { mapLimit } from './stt.js';

export interface SourceCue {
  /** Sequential id used in prompts (1-based cue index). */
  id: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranslatedItem {
  id: number;
  text: string;
  gender: Gender;
  /** True when translation failed and the source text was kept. */
  fallback?: boolean;
}

export const BATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'speaker_gender', 'text'],
        properties: {
          id: { type: 'integer' },
          speaker_gender: { type: 'string', enum: ['m', 'f', 'u'] },
          text: { type: 'string' },
        },
      },
    },
  },
} as const;

export function translationSystemPrompt(targetLanguage: string, withAudio: boolean): string {
  return [
    `You are a professional subtitle translator. Translate the cues into ${targetLanguage}.`,
    '',
    'Rules:',
    '- Natural, idiomatic spoken language as a native subtitler would write it. Concise: aim for about 17 characters per second of cue time; condense filler words rather than adding text.',
    '- Return exactly one item per input id. Never merge, split, drop or reorder cues.',
    '- Keep line breaks only where they help; keep <i>…</i> tags and dialogue dashes ("- ") exactly as in the source.',
    '- Keep names and recurring terms as given in the glossary. Do not translate personal names unless the glossary says so.',
    '- Translate bracketed sound labels and on-screen text, e.g. [door slams] → the target-language equivalent.',
    withAudio
      ? '- Listen to the attached audio clip to decide who is speaking: set speaker_gender to "m" or "f" from the voice (or "u" if unclear). Cue times "t" are relative to the start of the clip.'
      : '- Infer speaker_gender ("m", "f", "u") from context, names and the glossary.',
    '- Apply correct grammatical gender for the speaker and the addressee (critical for Slavic languages, e.g. Croatian "bio sam / bila sam", "jesi li spreman / spremna", Russian "я пошёл / пошла").',
    '- Respect the formality rules from the glossary (informal ti/du/tu vs formal Vi/Sie/vous). Default: informal between friends and family, formal with strangers and superiors.',
    '- Context lines are read-only, for understanding only. Do not translate or output them.',
    '- Use the correct script and orthography of the target language (diacritics such as č ć đ š ž must be present).',
    '- Output JSON only: {"items":[{"id":1,"speaker_gender":"m","text":"…"}]}',
  ].join('\n');
}

function clock(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

export interface ValidationResult {
  valid: Map<number, TranslatedItem>;
  invalid: number[];
  reasons: string[];
}

/** Checks the id set, non-empty text and a sane length (≤ max(90, 1.3 × source)). */
export function validateBatch(batch: SourceCue[], parsed: unknown): ValidationResult {
  const valid = new Map<number, TranslatedItem>();
  const reasons: string[] = [];
  const items = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(items)) {
    return { valid, invalid: batch.map((c) => c.id), reasons: ['response has no "items" array'] };
  }
  const byId = new Map(batch.map((c) => [c.id, c]));
  for (const raw of items as Record<string, unknown>[]) {
    const id = typeof raw?.id === 'number' ? raw.id : Number(raw?.id);
    const src = byId.get(id);
    if (!src) {
      if (Number.isFinite(id)) reasons.push(`unexpected id ${id}`);
      continue;
    }
    if (valid.has(id)) continue;
    const text = typeof raw.text === 'string' ? normalizeText(raw.text) : '';
    const g = raw.speaker_gender;
    const gender: Gender = g === 'm' || g === 'f' ? g : 'u';
    const srcLen = visibleLength(src.text);
    if (!text && srcLen > 0) {
      reasons.push(`empty text for id ${id}`);
      continue;
    }
    if (visibleLength(text) > Math.max(90, srcLen * 1.3)) {
      reasons.push(`text too long for id ${id}`);
      continue;
    }
    valid.set(id, { id, text, gender });
  }
  const invalid = batch.filter((c) => !valid.has(c.id)).map((c) => c.id);
  if (invalid.length && reasons.length === 0)
    reasons.push(`missing ids ${invalid.slice(0, 5).join(', ')}`);
  return { valid, invalid, reasons };
}

export interface TranslateCall {
  ms: number;
  promptTokens: number;
  completionTokens: number;
  audioTokens: number;
  costUsd: number | null;
  ok: boolean;
  error?: string;
  withAudio: boolean;
}

export interface TranslateOptions {
  /** All source cues in order (used for read-only context). */
  all: SourceCue[];
  /** Cues to translate; defaults to all. */
  targets?: SourceCue[];
  targetLanguage: string;
  sourceLanguage?: string | null;
  glossary: Glossary;
  chat: ChatProvider;
  model: string;
  batchSize: number;
  concurrency: number;
  useAudio: boolean;
  /** Returns an MP3 clip for [startSec, endSec]. Required when useAudio is true. */
  loadAudio?: (startSec: number, endSec: number) => Promise<Buffer>;
  reasoningEffort: ReasoningEffort;
  temperature: number;
  signal?: AbortSignal;
  log: JobLogger;
  onCall: (call: TranslateCall) => void;
  onProgress?: (done: number, total: number) => void;
}

/** Errors that will not get better by retrying (bad key, no credits, unknown model). */
function isFatal(err: unknown): boolean {
  return (
    err instanceof ProviderError &&
    (err.status === 401 || err.status === 402 || err.status === 403 || err.status === 404)
  );
}

function looksLikeAudioUnsupported(err: unknown): boolean {
  return (
    err instanceof ProviderError &&
    err.status === 400 &&
    /audio|modalit|input_audio/i.test(err.message)
  );
}

export async function translateCues(o: TranslateOptions): Promise<Map<number, TranslatedItem>> {
  const targets = o.targets ?? o.all;
  const results = new Map<number, TranslatedItem>();
  const position = new Map(o.all.map((c, i) => [c.id, i]));
  let audioEnabled = o.useAudio && o.chat.supportsAudio && !!o.loadAudio;
  if (o.useAudio && !o.chat.supportsAudio)
    o.log(
      'warn',
      'The translation model does not accept audio; speaker gender will be inferred from text only',
    );
  const system = (withAudio: boolean) => translationSystemPrompt(o.targetLanguage, withAudio);
  let done = 0;

  const glossaryPayload = {
    characters: o.glossary.characters,
    formality: o.glossary.formality,
    terms: o.glossary.terms,
    style_notes: o.glossary.styleNotes,
  };

  async function callOnce(cues: SourceCue[], withAudio: boolean): Promise<ValidationResult> {
    const firstPos = position.get(cues[0]!.id) ?? 0;
    const lastPos = position.get(cues[cues.length - 1]!.id) ?? firstPos;
    const before = o.all
      .slice(Math.max(0, firstPos - 8), firstPos)
      .map((c) => c.text.replace(/\n/g, ' '));
    const after = o.all.slice(lastPos + 1, lastPos + 5).map((c) => c.text.replace(/\n/g, ' '));
    const clipStart = Math.max(0, cues[0]!.startMs - 1000);
    const clipEnd = cues[cues.length - 1]!.endMs + 1000;
    const payload = {
      target_language: o.targetLanguage,
      source_language: o.sourceLanguage ?? 'auto',
      glossary: glossaryPayload,
      context_before: before,
      context_after: after,
      audio: withAudio
        ? `Attached clip covers ${clock(clipStart)}–${clock(clipEnd)} of the video; "t" is relative to the clip start.`
        : 'none',
      cues: cues.map((c) => ({
        id: c.id,
        t: `${clock(c.startMs - (withAudio ? clipStart : 0))}-${clock(c.endMs - (withAudio ? clipStart : 0))}`,
        text: c.text,
      })),
    };
    const content: ChatPart[] = [{ type: 'text', text: JSON.stringify(payload) }];
    if (withAudio && o.loadAudio) {
      const mp3 = await o.loadAudio(clipStart / 1000, clipEnd / 1000);
      content.push({ type: 'audio', data: mp3.toString('base64'), format: 'mp3' });
    }
    const t0 = Date.now();
    try {
      const res = await o.chat.complete({
        model: o.model,
        messages: [
          { role: 'system', content: system(withAudio) },
          { role: 'user', content },
        ],
        jsonSchema: {
          name: 'subtitle_batch',
          schema: BATCH_SCHEMA as unknown as Record<string, unknown>,
        },
        temperature: o.temperature,
        maxTokens: 8000,
        reasoningEffort: o.reasoningEffort,
        signal: o.signal,
      });
      o.onCall({
        ms: Date.now() - t0,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        audioTokens: res.audioTokens,
        costUsd: res.costUsd,
        ok: true,
        withAudio,
      });
      let parsed: unknown;
      try {
        parsed = parseModelJson(res.content);
      } catch {
        return {
          valid: new Map(),
          invalid: cues.map((c) => c.id),
          reasons: ['response was not valid JSON'],
        };
      }
      return validateBatch(cues, parsed);
    } catch (err) {
      if (!isAbortError(err)) {
        o.onCall({
          ms: Date.now() - t0,
          promptTokens: 0,
          completionTokens: 0,
          audioTokens: 0,
          costUsd: 0,
          ok: false,
          error: (err as Error).message,
          withAudio,
        });
      }
      throw err;
    }
  }

  function accept(items: Map<number, TranslatedItem>) {
    for (const [id, item] of items) {
      if (!results.has(id)) {
        results.set(id, item);
        done++;
      }
    }
    o.onProgress?.(done, targets.length);
  }

  /** Retry ×2 → split in half → retry without audio → keep source text. */
  async function translateGroup(
    cues: SourceCue[],
    withAudio: boolean,
    depth: number,
  ): Promise<void> {
    let pending = cues;
    for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
      try {
        const r = await callOnce(pending, withAudio);
        accept(r.valid);
        if (r.invalid.length) {
          o.log(
            'debug',
            `Batch validation: ${r.reasons.slice(0, 3).join('; ')} (attempt ${attempt + 1})`,
          );
          const invalid = new Set(r.invalid);
          pending = pending.filter((c) => invalid.has(c.id));
        } else pending = [];
      } catch (err) {
        if (isAbortError(err) || isFatal(err)) throw err;
        if (withAudio && looksLikeAudioUnsupported(err)) {
          o.log(
            'warn',
            `Model rejected audio input (${(err as Error).message}); continuing without audio`,
          );
          audioEnabled = false;
          return translateGroup(pending, false, depth);
        }
        o.log(
          'warn',
          `Translation request failed (attempt ${attempt + 1}): ${(err as Error).message}`,
        );
      }
    }
    if (!pending.length) return;
    if (pending.length > 1 && depth < 5) {
      const mid = Math.ceil(pending.length / 2);
      o.log('info', `Splitting ${pending.length} cue(s) into smaller batches`);
      await translateGroup(pending.slice(0, mid), withAudio, depth + 1);
      await translateGroup(pending.slice(mid), withAudio, depth + 1);
      return;
    }
    if (withAudio) {
      o.log('info', `Retrying ${pending.length} cue(s) without audio`);
      await translateGroup(pending, false, depth + 1);
      return;
    }
    for (const c of pending) {
      o.log('warn', `Cue ${c.id}: translation failed after all retries, keeping source text`, {
        text: c.text,
      });
    }
    accept(
      new Map(
        pending.map((c) => [
          c.id,
          { id: c.id, text: c.text, gender: 'u' as Gender, fallback: true },
        ]),
      ),
    );
  }

  const batches: SourceCue[][] = [];
  for (let i = 0; i < targets.length; i += o.batchSize)
    batches.push(targets.slice(i, i + o.batchSize));
  o.onProgress?.(0, targets.length);
  await mapLimit(batches, o.concurrency, (batch) => translateGroup(batch, audioEnabled, 0));
  return results;
}
