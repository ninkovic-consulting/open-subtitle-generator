import {
  EMPTY_GLOSSARY,
  glossarySchema,
  type Glossary,
  type ReasoningEffort,
} from '../../shared/types.js';
import { isAbortError, type ChatProvider } from '../providers/types.js';
import { parseModelJson } from './json.js';
import type { JobLogger } from './joblog.js';

export const CONTEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['characters', 'formality', 'terms', 'style_notes'],
  properties: {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'gender', 'notes'],
        properties: {
          name: { type: 'string' },
          gender: { type: 'string', enum: ['m', 'f', 'u'] },
          notes: { type: 'string' },
        },
      },
    },
    formality: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['speaker', 'addressee', 'form', 'notes'],
        properties: {
          speaker: { type: 'string' },
          addressee: { type: 'string' },
          form: { type: 'string', enum: ['informal', 'formal'] },
          notes: { type: 'string' },
        },
      },
    },
    terms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'target', 'notes'],
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          notes: { type: 'string' },
        },
      },
    },
    style_notes: { type: 'string' },
  },
} as const;

const MAX_TRANSCRIPT_CHARS = 60_000;

export function contextSystemPrompt(targetLanguage: string): string {
  return [
    'You analyse a TV/movie transcript to prepare a professional subtitle translation into',
    `${targetLanguage}. Return JSON only, matching the schema.`,
    '- characters: every named or recurring speaking character. gender: "m", "f" or "u" if unclear.',
    '  notes: one short line (role, relationships) useful to a translator.',
    '- formality: pairs where the target language must choose informal vs formal address',
    '  (e.g. Croatian ti/Vi, German du/Sie). Judge from relationships (family, friends → informal;',
    '  strangers, superiors, officials → formal).',
    `- terms: names of people, places, organisations, ranks and recurring phrases with their ${targetLanguage}`,
    '  form. Keep personal names unchanged unless there is an established localised form.',
    '- style_notes: tone, register, era, slang, anything that affects word choice (max 3 sentences).',
    'Do not invent characters that are not in the transcript.',
  ].join('\n');
}

export interface ContextPassOptions {
  lines: { startMs: number; text: string }[];
  existing: Glossary;
  targetLanguage: string;
  chat: ChatProvider;
  model: string;
  reasoningEffort: ReasoningEffort;
  signal?: AbortSignal;
  log: JobLogger;
  onCall: (call: {
    ms: number;
    promptTokens: number;
    completionTokens: number;
    audioTokens: number;
    costUsd: number | null;
    ok: boolean;
    error?: string;
  }) => void;
}

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Runs the character/glossary pass and merges it into the existing glossary. Never throws on bad output. */
export async function runContextPass(o: ContextPassOptions): Promise<Glossary> {
  let transcript = o.lines
    .map((l) => `[${mmss(l.startMs)}] ${l.text.replace(/\n/g, ' ')}`)
    .join('\n');
  if (transcript.length > MAX_TRANSCRIPT_CHARS)
    transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  const existingSummary = JSON.stringify({
    characters: o.existing.characters,
    formality: o.existing.formality,
    terms: o.existing.terms,
  });
  const t0 = Date.now();
  try {
    const res = await o.chat.complete({
      model: o.model,
      messages: [
        { role: 'system', content: contextSystemPrompt(o.targetLanguage) },
        {
          role: 'user',
          content: `Known glossary from earlier episodes (keep consistent, add what is new):\n${existingSummary}\n\nTranscript:\n${transcript}`,
        },
      ],
      jsonSchema: {
        name: 'subtitle_context',
        schema: CONTEXT_SCHEMA as unknown as Record<string, unknown>,
      },
      temperature: 0.2,
      maxTokens: 6000,
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
    });
    const raw = parseModelJson(res.content) as Record<string, unknown>;
    const incoming = glossarySchema.parse({
      characters: raw.characters,
      formality: raw.formality,
      terms: raw.terms,
      styleNotes: typeof raw.style_notes === 'string' ? raw.style_notes : '',
    });
    const merged = mergeGlossary(o.existing, incoming);
    o.log(
      'info',
      `Context pass: ${incoming.characters.length} characters, ${incoming.terms.length} terms, ${incoming.formality.length} formality rules`,
    );
    return merged;
  } catch (err) {
    if (isAbortError(err)) throw err;
    o.onCall({
      ms: Date.now() - t0,
      promptTokens: 0,
      completionTokens: 0,
      audioTokens: 0,
      costUsd: 0,
      ok: false,
      error: (err as Error).message,
    });
    o.log(
      'warn',
      `Context pass failed, continuing with the existing glossary: ${(err as Error).message}`,
    );
    return o.existing;
  }
}

const key = (s: string) => s.trim().toLowerCase();

/** Merges glossaries. Existing (possibly user-edited) entries win; unknown genders get filled in. */
export function mergeGlossary(existing: Glossary, incoming: Glossary): Glossary {
  const base = glossarySchema.parse(existing ?? EMPTY_GLOSSARY);
  const characters = [...base.characters];
  for (const c of incoming.characters) {
    if (!c.name.trim()) continue;
    const found = characters.find((x) => key(x.name) === key(c.name));
    if (!found) characters.push(c);
    else {
      if (found.gender === 'u' && c.gender !== 'u') found.gender = c.gender;
      if (!found.notes && c.notes) found.notes = c.notes;
    }
  }
  const formality = [...base.formality];
  for (const f of incoming.formality) {
    if (!f.speaker.trim() || !f.addressee.trim()) continue;
    if (
      !formality.some(
        (x) => key(x.speaker) === key(f.speaker) && key(x.addressee) === key(f.addressee),
      )
    )
      formality.push(f);
  }
  const terms = [...base.terms];
  for (const t of incoming.terms) {
    if (!t.source.trim()) continue;
    if (!terms.some((x) => key(x.source) === key(t.source))) terms.push(t);
  }
  return {
    characters,
    formality,
    terms,
    styleNotes: base.styleNotes || incoming.styleNotes,
  };
}
