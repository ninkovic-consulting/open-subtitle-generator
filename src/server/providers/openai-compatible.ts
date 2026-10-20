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

/**
 * Generic client for any OpenAI-compatible server: Speaches/faster-whisper-server, whisper.cpp,
 * LocalAI, Ollama, LM Studio, vLLM, llama.cpp, Groq, OpenAI itself, …
 */
export function normalizeBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  url = url.replace(/\/(chat\/completions|audio\/transcriptions)$/, '');
  return url;
}

function headers(apiKey: string, json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (apiKey.trim()) h.Authorization = `Bearer ${apiKey.trim()}`;
  return h;
}

async function readError(res: Response, label: string): Promise<ProviderError> {
  const body = await res.text().catch(() => '');
  let detail = body.slice(0, 500);
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; detail?: unknown };
    if (typeof j.error === 'string') detail = j.error;
    else if (j.error?.message) detail = j.error.message;
    else if (j.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
  } catch {
    // keep raw body
  }
  return new ProviderError(
    `${label} ${res.status}: ${detail || res.statusText}`,
    res.status,
    retryableStatus(res.status),
    body,
  );
}

function connectionMessage(err: unknown, url: string): string {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code ?? '';
  if (code === 'ECONNREFUSED') return `Nothing is listening at ${url}. Is the server running?`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    return `Cannot resolve the host of ${url}. Check the base URL.`;
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT')
    return `Connection to ${url} timed out.`;
  return `Cannot reach ${url}: ${cause?.message ?? (err as Error).message}`;
}

async function withRetries<T>(
  fn: () => Promise<T>,
  url: string,
  signal?: AbortSignal,
  attempts = 4,
): Promise<T> {
  let delay = 1000;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw err;
      const retryable = err instanceof ProviderError ? err.retryable : true;
      const refused = (err as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED';
      if (!retryable || i >= attempts - 1 || (refused && i >= 1)) {
        if (err instanceof ProviderError) throw err;
        throw new ProviderError(connectionMessage(err, url), null, true);
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15_000);
    }
  }
}

interface OpenAiTranscription {
  text?: string;
  language?: string;
  duration?: number;
  segments?: {
    start: number;
    end: number;
    text: string;
    no_speech_prob?: number;
    avg_logprob?: number;
  }[];
  words?: { start: number; end: number; word: string }[];
}

/** Whisper returns language names ("english") in verbose_json; normalise common ones to ISO codes. */
const LANGUAGE_NAMES: Record<string, string> = {
  english: 'en',
  croatian: 'hr',
  serbian: 'sr',
  bosnian: 'bs',
  slovenian: 'sl',
  german: 'de',
  french: 'fr',
  spanish: 'es',
  italian: 'it',
  portuguese: 'pt',
  dutch: 'nl',
  polish: 'pl',
  czech: 'cs',
  slovak: 'sk',
  hungarian: 'hu',
  romanian: 'ro',
  russian: 'ru',
  ukrainian: 'uk',
  bulgarian: 'bg',
  macedonian: 'mk',
  greek: 'el',
  turkish: 'tr',
  hebrew: 'he',
  arabic: 'ar',
  persian: 'fa',
  japanese: 'ja',
  korean: 'ko',
  chinese: 'zh',
  hindi: 'hi',
  swedish: 'sv',
  danish: 'da',
  norwegian: 'no',
  finnish: 'fi',
  vietnamese: 'vi',
  thai: 'th',
  indonesian: 'id',
};

export function normalizeLanguage(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const l = lang.trim().toLowerCase();
  return LANGUAGE_NAMES[l] ?? l;
}

export class OpenAICompatibleStt implements SttProvider {
  readonly kind = 'custom' as const;
  readonly label: string;
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {
    this.label = normalizeBaseUrl(baseUrl);
  }

  async transcribe(req: SttRequest): Promise<SttResult> {
    const url = `${normalizeBaseUrl(this.baseUrl)}/audio/transcriptions`;
    const json = await withRetries(
      async () => {
        const form = new FormData();
        form.append(
          'file',
          new Blob([new Uint8Array(req.audio)], {
            type: req.format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
          }),
          `audio.${req.format}`,
        );
        form.append('model', req.model);
        form.append('response_format', 'verbose_json');
        form.append('temperature', '0');
        for (const g of req.granularities) form.append('timestamp_granularities[]', g);
        if (req.language) form.append('language', req.language);
        const res = await fetch(url, {
          method: 'POST',
          headers: headers(this.apiKey, false),
          body: form,
          signal: req.signal,
        });
        if (!res.ok) throw await readError(res, 'STT endpoint');
        return (await res.json()) as OpenAiTranscription;
      },
      url,
      req.signal,
    );
    return {
      text: json.text ?? '',
      language: normalizeLanguage(json.language),
      duration: json.duration,
      segments: (json.segments ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        noSpeechProb: s.no_speech_prob,
        avgLogprob: s.avg_logprob,
      })),
      words: json.words ?? [],
      costUsd: null,
      model: req.model,
    };
  }
}

interface OpenAiChatResponse {
  model?: string;
  choices?: { message?: { content?: string | { type: string; text?: string }[] | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { audio_tokens?: number };
  };
}

export class OpenAICompatibleChat implements ChatProvider {
  readonly kind = 'custom' as const;
  readonly label: string;
  /** Downgraded at runtime if the server rejects `json_schema`. */
  private jsonMode: 'json_schema' | 'json_object' | 'none';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly supportsAudio: boolean,
    readonly supportsJsonSchema: boolean,
  ) {
    this.label = normalizeBaseUrl(baseUrl);
    this.jsonMode = supportsJsonSchema ? 'json_schema' : 'none';
  }

  private body(req: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      stream: false,
      messages: req.messages.map((m) => ({
        role: m.role,
        content:
          typeof m.content === 'string'
            ? m.content
            : m.content.map((p) =>
                p.type === 'text'
                  ? { type: 'text', text: p.text }
                  : { type: 'input_audio', input_audio: { data: p.data, format: p.format } },
              ),
      })),
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.jsonSchema && this.jsonMode === 'json_schema') {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: req.jsonSchema.name, strict: true, schema: req.jsonSchema.schema },
      };
    } else if (req.jsonSchema && this.jsonMode === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    return body;
  }

  async complete(req: ChatRequest): Promise<ChatResult> {
    const url = `${normalizeBaseUrl(this.baseUrl)}/chat/completions`;
    const json = await withRetries(
      async () => {
        for (;;) {
          const res = await fetch(url, {
            method: 'POST',
            headers: headers(this.apiKey),
            body: JSON.stringify(this.body(req)),
            signal: req.signal,
          });
          if (res.ok) return (await res.json()) as OpenAiChatResponse;
          const err = await readError(res, 'Chat endpoint');
          // Some servers reject structured output: step down json_schema → json_object → plain.
          if (
            req.jsonSchema &&
            res.status >= 400 &&
            res.status < 500 &&
            this.jsonMode !== 'none' &&
            /response_format|json_schema|json_object|schema/i.test(err.body ?? err.message)
          ) {
            this.jsonMode = this.jsonMode === 'json_schema' ? 'json_object' : 'none';
            continue;
          }
          throw err;
        }
      },
      url,
      req.signal,
    );
    const msg = json.choices?.[0]?.message?.content;
    const content =
      typeof msg === 'string'
        ? msg
        : Array.isArray(msg)
          ? msg.map((p) => p.text ?? '').join('')
          : '';
    return {
      content,
      model: json.model ?? req.model,
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      audioTokens: json.usage?.prompt_tokens_details?.audio_tokens ?? 0,
      costUsd: typeof json.usage?.cost === 'number' ? json.usage.cost : null,
    };
  }
}

/** GET {baseUrl}/models → list of model ids (used for dropdowns and connection tests). */
export async function listCompatibleModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const url = `${normalizeBaseUrl(baseUrl)}/models`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: headers(apiKey, false),
      signal: signal ?? AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw new ProviderError(connectionMessage(err, normalizeBaseUrl(baseUrl)), null, true);
  }
  if (!res.ok) throw await readError(res, 'Models endpoint');
  const json = (await res.json()) as {
    data?: { id: string }[];
    models?: { name?: string; model?: string }[];
  };
  if (Array.isArray(json.data)) return json.data.map((m) => m.id).filter(Boolean);
  if (Array.isArray(json.models))
    return json.models.map((m) => m.model ?? m.name ?? '').filter(Boolean);
  return [];
}
