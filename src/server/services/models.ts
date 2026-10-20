import {
  DEFAULT_STT_MODEL,
  DEFAULT_TRANSLATE_MODEL,
  OPENROUTER_BASE_URL,
  type ModelInfo,
  type Settings,
} from '../../shared/types.js';
import { listCompatibleModels } from '../providers/openai-compatible.js';
import { logger } from '../logger.js';
import { resolveOpenRouterKey } from './settings.js';

interface RawModel {
  id: string;
  name?: string;
  context_length?: number | null;
  pricing?: { prompt?: string; completion?: string; audio?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
}

/** Fallback prices (USD) so estimates work offline. STT prompt price is per second of audio. */
const FALLBACK: Record<string, ModelInfo> = {
  [DEFAULT_STT_MODEL]: {
    id: DEFAULT_STT_MODEL,
    name: 'Whisper Large v3',
    promptPrice: 0.0000075,
    completionPrice: 0,
    audioPrice: null,
    audioInput: true,
    structuredOutput: false,
    contextLength: null,
  },
  [DEFAULT_TRANSLATE_MODEL]: {
    id: DEFAULT_TRANSLATE_MODEL,
    name: 'Gemini 3.1 Flash Lite',
    promptPrice: 0.25e-6,
    completionPrice: 1.5e-6,
    audioPrice: 0.5e-6,
    audioInput: true,
    structuredOutput: true,
    contextLength: 1_000_000,
  },
};

const TTL_MS = 6 * 60 * 60 * 1000;
const cache: Record<'stt' | 'chat', { at: number; models: ModelInfo[] } | undefined> = {
  stt: undefined,
  chat: undefined,
};

function num(v: string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toInfo(m: RawModel): ModelInfo {
  return {
    id: m.id,
    name: m.name ?? m.id,
    promptPrice: num(m.pricing?.prompt),
    completionPrice: num(m.pricing?.completion),
    audioPrice: num(m.pricing?.audio),
    audioInput: (m.architecture?.input_modalities ?? []).includes('audio'),
    structuredOutput:
      (m.supported_parameters ?? []).includes('structured_outputs') ||
      (m.supported_parameters ?? []).includes('response_format'),
    contextLength: m.context_length ?? null,
  };
}

/** OpenRouter model catalog (cached 6 h). `stt` = transcription models; `chat` = text-output models. */
export async function getOpenRouterModels(
  kind: 'stt' | 'chat',
  settings?: Settings,
): Promise<ModelInfo[]> {
  const hit = cache[kind];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.models;
  const url = new URL(`${OPENROUTER_BASE_URL}/models`);
  if (kind === 'stt') url.searchParams.set('output_modalities', 'transcription');
  const headers: Record<string, string> = {};
  const key = settings ? resolveOpenRouterKey(settings) : '';
  if (key) headers.Authorization = `Bearer ${key}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data: RawModel[] };
    let models = json.data
      .map(toInfo)
      .filter((m) => !m.id.includes(':batch') && (m.promptPrice ?? 0) >= 0);
    if (kind === 'chat')
      models = models.filter((m) => m.promptPrice !== null && m.promptPrice >= 0);
    models.sort((a, b) => Number(b.audioInput) - Number(a.audioInput) || a.id.localeCompare(b.id));
    cache[kind] = { at: Date.now(), models };
    return models;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Could not fetch OpenRouter model list');
    return Object.values(FALLBACK).filter((m) =>
      kind === 'stt' ? m.id === DEFAULT_STT_MODEL : m.id !== DEFAULT_STT_MODEL,
    );
  }
}

/** Price info for a model id; falls back to built-in prices for the defaults. */
export async function getModelPricing(id: string, kind: 'stt' | 'chat'): Promise<ModelInfo | null> {
  const models = await getOpenRouterModels(kind).catch(() => []);
  return models.find((m) => m.id === id) ?? FALLBACK[id] ?? null;
}

/** Models from a custom OpenAI-compatible endpoint (`GET /models`). */
export async function getCustomModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
  const ids = await listCompatibleModels(baseUrl, apiKey);
  return ids.map((id) => ({
    id,
    name: id,
    promptPrice: 0,
    completionPrice: 0,
    audioPrice: 0,
    audioInput: false,
    structuredOutput: false,
    contextLength: null,
  }));
}

export function clearModelCache(): void {
  cache.stt = undefined;
  cache.chat = undefined;
}
