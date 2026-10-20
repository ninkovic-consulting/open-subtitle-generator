import type { Settings } from '../../shared/types.js';
import type { ModelInfo } from '../../shared/types.js';

/** Gemini bills ~32 audio tokens per second of input audio. */
export const AUDIO_TOKENS_PER_SEC = 32;
/** Rough speech density: ~2.6 words/s → ~4 tokens/s of source text. */
const TEXT_TOKENS_PER_SEC = 4;
const SYSTEM_PROMPT_TOKENS = 900;
const CONTEXT_OVERHEAD = 1.6;

export interface CostEstimateInput {
  durationSec: number;
  needsStt: boolean;
  useAudio: boolean;
  batchSize: number;
  sttPricing: ModelInfo | null;
  chatPricing: ModelInfo | null;
  sttIsCustom: boolean;
  chatIsCustom: boolean;
}

export interface CostEstimate {
  sttUsd: number;
  translateUsd: number;
  totalUsd: number;
  pricingKnown: boolean;
}

/** Estimate = audio sec × STT price + audio tokens × audio price + text tokens × text prices. */
export function estimateCost(i: CostEstimateInput): CostEstimate {
  let pricingKnown = true;
  let sttUsd = 0;
  if (i.needsStt && !i.sttIsCustom) {
    if (i.sttPricing?.promptPrice != null) sttUsd = i.durationSec * i.sttPricing.promptPrice;
    else pricingKnown = false;
  }
  let translateUsd = 0;
  if (!i.chatIsCustom) {
    const p = i.chatPricing;
    if (p?.promptPrice != null && p.completionPrice != null) {
      const sourceTokens = i.durationSec * TEXT_TOKENS_PER_SEC;
      const cues = Math.max(1, i.durationSec / 3);
      const batches = Math.max(1, Math.ceil(cues / i.batchSize));
      const promptTokens =
        sourceTokens * CONTEXT_OVERHEAD +
        batches * SYSTEM_PROMPT_TOKENS +
        sourceTokens; /* context pass */
      const completionTokens = sourceTokens * 1.6 + 1500;
      translateUsd = promptTokens * p.promptPrice + completionTokens * p.completionPrice;
      if (i.useAudio) {
        const audioTokens = (i.durationSec + batches * 2) * AUDIO_TOKENS_PER_SEC;
        translateUsd += audioTokens * (p.audioPrice ?? p.promptPrice);
      }
    } else {
      pricingKnown = false;
    }
  }
  return { sttUsd, translateUsd, totalUsd: sttUsd + translateUsd, pricingKnown };
}

/** Fallback cost when a provider does not report `usage.cost`. */
export function costFromUsage(
  pricing: ModelInfo | null,
  usage: { promptTokens: number; completionTokens: number; audioTokens: number },
): number {
  if (!pricing || pricing.promptPrice == null) return 0;
  const textIn = Math.max(0, usage.promptTokens - usage.audioTokens);
  return (
    textIn * pricing.promptPrice +
    usage.audioTokens * (pricing.audioPrice ?? pricing.promptPrice) +
    usage.completionTokens * (pricing.completionPrice ?? 0)
  );
}

export function isCustom(settings: Settings, which: 'stt' | 'translation'): boolean {
  return settings[which].provider === 'custom';
}
