import type { Settings } from '../../shared/types.js';
import { resolveOpenRouterKey } from '../services/settings.js';
import { OpenAICompatibleChat, OpenAICompatibleStt } from './openai-compatible.js';
import { OpenRouterChat, OpenRouterStt, createOpenRouterClient } from './openrouter.js';
import { ProviderError, type ChatProvider, type SttProvider } from './types.js';

export * from './types.js';

export interface Providers {
  stt: SttProvider;
  chat: ChatProvider;
}

/** Factory overridable in tests (inject fakes instead of real network clients). */
export type ProviderFactory = (settings: Settings) => Providers;

function requireKey(settings: Settings): string {
  const key = resolveOpenRouterKey(settings);
  if (!key) {
    throw new ProviderError(
      'No OpenRouter API key. Add it in Settings (or set OPENROUTER_API_KEY in .env), or switch both providers to a custom endpoint.',
      401,
      false,
    );
  }
  return key;
}

export const defaultProviderFactory: ProviderFactory = (settings) => {
  let orClient: ReturnType<typeof createOpenRouterClient> | null = null;
  const openRouter = () => (orClient ??= createOpenRouterClient(requireKey(settings)));

  const stt: SttProvider =
    settings.stt.provider === 'custom'
      ? new OpenAICompatibleStt(settings.stt.baseUrl, settings.stt.apiKey)
      : lazyStt(() => new OpenRouterStt(openRouter()));
  const chat: ChatProvider =
    settings.translation.provider === 'custom'
      ? new OpenAICompatibleChat(
          settings.translation.baseUrl,
          settings.translation.apiKey,
          settings.translation.audioInput,
          settings.translation.structuredOutput,
        )
      : lazyChat(() => new OpenRouterChat(openRouter()));
  return { stt, chat };
};

function lazyStt(make: () => SttProvider): SttProvider {
  let inst: SttProvider | null = null;
  return {
    kind: 'openrouter',
    label: 'OpenRouter',
    transcribe: (req) => (inst ??= make()).transcribe(req),
  };
}

function lazyChat(make: () => ChatProvider): ChatProvider {
  let inst: ChatProvider | null = null;
  return {
    kind: 'openrouter',
    label: 'OpenRouter',
    supportsAudio: true,
    supportsJsonSchema: true,
    complete: (req) => (inst ??= make()).complete(req),
  };
}

let factory: ProviderFactory = defaultProviderFactory;

export function setProviderFactory(f: ProviderFactory | null): void {
  factory = f ?? defaultProviderFactory;
}

export function createProviders(settings: Settings): Providers {
  return factory(settings);
}
