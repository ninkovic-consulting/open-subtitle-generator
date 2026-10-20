import type { ReasoningEffort } from '../../shared/types.js';

export type AudioFormat = 'mp3' | 'wav';

export interface SttRequest {
  audio: Buffer;
  format: AudioFormat;
  model: string;
  /** ISO 639-1 hint; omitted for auto-detect. */
  language?: string;
  granularities: ('word' | 'segment')[];
  signal?: AbortSignal;
}

export interface SttWord {
  start: number;
  end: number;
  word: string;
}

export interface SttSegment {
  start: number;
  end: number;
  text: string;
  noSpeechProb?: number;
  avgLogprob?: number;
}

export interface SttResult {
  text: string;
  language?: string;
  duration?: number;
  segments: SttSegment[];
  words: SttWord[];
  costUsd: number | null;
  model: string;
}

export type ChatPart =
  { type: 'text'; text: string } | { type: 'audio'; data: string; format: AudioFormat };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatPart[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  audioTokens: number;
  costUsd: number | null;
}

export interface SttProvider {
  readonly kind: 'openrouter' | 'custom';
  readonly label: string;
  transcribe(req: SttRequest): Promise<SttResult>;
}

export interface ChatProvider {
  readonly kind: 'openrouter' | 'custom';
  readonly label: string;
  /** Whether `audio` parts are accepted (voice-based gender detection). */
  readonly supportsAudio: boolean;
  /** Whether `response_format: json_schema` is honoured. */
  readonly supportsJsonSchema: boolean;
  complete(req: ChatRequest): Promise<ChatResult>;
}

/** Normalised error from any provider. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' ||
      err.name === 'RequestAbortedError' ||
      /aborted/i.test(err.message))
  );
}

export function retryableStatus(status: number | null): boolean {
  return status === null || status === 408 || status === 409 || status === 429 || status >= 500;
}
