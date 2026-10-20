import { OpenRouter } from '@openrouter/sdk';
import type { ChatRequest as ORChatRequest } from '@openrouter/sdk/models';
import { config } from '../config.js';
import {
  ProviderError,
  isAbortError,
  retryableStatus,
  type ChatProvider,
  type ChatRequest,
  type ChatResult,
  type SttProvider,
  type SttRequest,
  type SttResult,
} from './types.js';

export function createOpenRouterClient(apiKey: string): OpenRouter {
  return new OpenRouter({
    apiKey,
    httpReferer: config.appUrl,
    appTitle: config.appTitle,
    timeoutMs: 10 * 60_000,
    retryConfig: {
      strategy: 'backoff',
      backoff: { initialInterval: 1000, maxInterval: 30_000, exponent: 2, maxElapsedTime: 120_000 },
      retryConnectionErrors: true,
    },
  });
}

/** Converts SDK errors into {@link ProviderError} with a readable message. */
export function toProviderError(err: unknown): Error {
  if (isAbortError(err)) return err as Error;
  if (err instanceof ProviderError) return err;
  const e = err as { statusCode?: number; body?: string; message?: string; name?: string };
  const status = typeof e.statusCode === 'number' ? e.statusCode : null;
  let detail = e.message ?? String(err);
  if (e.body) {
    try {
      const parsed = JSON.parse(e.body) as { error?: { message?: string; metadata?: unknown } };
      if (parsed.error?.message) detail = parsed.error.message;
      const raw = (parsed.error?.metadata as { raw?: string } | undefined)?.raw;
      if (raw) detail += ` (${String(raw).slice(0, 300)})`;
    } catch {
      detail = e.body.slice(0, 500);
    }
  }
  const label = status ? `OpenRouter ${status}: ${detail}` : `OpenRouter: ${detail}`;
  return new ProviderError(label, status, retryableStatus(status), e.body);
}

export class OpenRouterStt implements SttProvider {
  readonly kind = 'openrouter' as const;
  readonly label = 'OpenRouter';
  constructor(private readonly client: OpenRouter) {}

  async transcribe(req: SttRequest): Promise<SttResult> {
    try {
      const res = await this.client.stt.createTranscription(
        {
          sttRequest: {
            model: req.model,
            inputAudio: { data: req.audio.toString('base64'), format: req.format },
            responseFormat: 'verbose_json',
            timestampGranularities: req.granularities,
            language: req.language,
            temperature: 0,
          },
        },
        { signal: req.signal },
      );
      return {
        text: res.text ?? '',
        language: res.language,
        duration: res.duration,
        segments: (res.segments ?? []).map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
          noSpeechProb: s.noSpeechProb,
          avgLogprob: s.avgLogprob,
        })),
        words: (res.words ?? [])
          .filter((w) => w.type !== 'audio_event')
          .map((w) => ({ start: w.start, end: w.end, word: w.word })),
        costUsd: res.usage?.cost ?? null,
        model: req.model,
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }
}

export class OpenRouterChat implements ChatProvider {
  readonly kind = 'openrouter' as const;
  readonly label = 'OpenRouter';
  readonly supportsAudio = true;
  readonly supportsJsonSchema = true;
  constructor(private readonly client: OpenRouter) {}

  async complete(req: ChatRequest): Promise<ChatResult> {
    const chatRequest: ORChatRequest = {
      model: req.model,
      messages: req.messages.map((m) => {
        if (typeof m.content === 'string' || m.role !== 'user') {
          const text =
            typeof m.content === 'string'
              ? m.content
              : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
          return { role: m.role, content: text } as ORChatRequest['messages'][number];
        }
        return {
          role: 'user',
          content: m.content.map((p) =>
            p.type === 'text'
              ? { type: 'text' as const, text: p.text }
              : { type: 'input_audio' as const, inputAudio: { data: p.data, format: p.format } },
          ),
        } as ORChatRequest['messages'][number];
      }),
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      stream: false,
    };
    if (req.reasoningEffort && req.reasoningEffort !== 'none') {
      chatRequest.reasoning = { effort: req.reasoningEffort };
    }
    if (req.jsonSchema) {
      chatRequest.responseFormat = {
        type: 'json_schema',
        jsonSchema: { name: req.jsonSchema.name, strict: true, schema: req.jsonSchema.schema },
      };
      chatRequest.plugins = [{ id: 'response-healing' }];
    }
    try {
      const res = await this.client.chat.send(
        { chatRequest: { ...chatRequest, stream: false } },
        {
          signal: req.signal,
        },
      );
      if (!('choices' in res))
        throw new ProviderError('Unexpected streaming response', null, false);
      const msg = res.choices[0]?.message;
      let content = '';
      if (typeof msg?.content === 'string') content = msg.content;
      else if (Array.isArray(msg?.content))
        content = msg.content.map((p) => ('text' in p ? String(p.text) : '')).join('');
      return {
        content,
        model: res.model,
        promptTokens: res.usage?.promptTokens ?? 0,
        completionTokens: res.usage?.completionTokens ?? 0,
        audioTokens: res.usage?.promptTokensDetails?.audioTokens ?? 0,
        costUsd: res.usage?.cost ?? null,
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }
}
