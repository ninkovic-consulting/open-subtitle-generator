import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  OPENROUTER_BASE_URL,
  settingsUpdateSchema,
  testProviderSchema,
  type Settings,
  type TestProviderResult,
} from '../../shared/types.js';
import { config } from '../config.js';
import { parse } from '../http.js';
import { createProviders } from '../providers/index.js';
import { listCompatibleModels } from '../providers/openai-compatible.js';
import { recordApiCall } from '../services/joblog.js';
import { FFMPEG, run } from '../services/media.js';
import { clearModelCache, getCustomModels, getOpenRouterModels } from '../services/models.js';
import {
  loadSettings,
  resetSettings,
  resolveOpenRouterKey,
  toSettingsResponse,
  updateSettings,
} from '../services/settings.js';

/** Merge unsaved form values over stored settings so users can test before saving. */
function withOverrides(body: z.infer<typeof testProviderSchema>): Settings {
  const s = loadSettings();
  const clean = <T extends { apiKey?: string }>(v: T | undefined) => {
    if (!v) return {};
    const copy = { ...v };
    if (copy.apiKey?.includes('•')) delete copy.apiKey;
    return copy;
  };
  return {
    ...s,
    openrouterApiKey:
      body.openrouterApiKey && !body.openrouterApiKey.includes('•')
        ? body.openrouterApiKey
        : s.openrouterApiKey,
    stt: { ...s.stt, ...clean(body.stt) },
    translation: { ...s.translation, ...clean(body.translation) },
  };
}

let testClip: Buffer | null = null;
/** 2 s, 440 Hz tone as MP3 (generated once with ffmpeg). */
async function getTestClip(): Promise<Buffer> {
  if (testClip) return testClip;
  const { stdout } = await run(FFMPEG, [
    '-nostdin',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
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
  testClip = stdout;
  return stdout;
}

async function testOpenRouterKey(key: string): Promise<TestProviderResult> {
  if (!key) return { ok: false, message: 'No OpenRouter API key set' };
  const res = await fetch(`${OPENROUTER_BASE_URL}/key`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    return {
      ok: false,
      message:
        res.status === 401
          ? 'OpenRouter rejected this key (401)'
          : `OpenRouter answered HTTP ${res.status}`,
    };
  }
  const json = (await res.json()) as {
    data?: {
      label?: string;
      usage?: number;
      limit?: number | null;
      limit_remaining?: number | null;
      is_free_tier?: boolean;
    };
  };
  const d = json.data ?? {};
  const details = [
    d.label ? `Key: ${d.label}` : null,
    typeof d.usage === 'number' ? `Used so far: $${d.usage.toFixed(2)}` : null,
    d.limit != null ? `Limit: $${d.limit}` : 'No spending limit',
    d.limit_remaining != null ? `Remaining: $${d.limit_remaining.toFixed(2)}` : null,
    d.is_free_tier ? 'Free tier (add credits for paid models)' : null,
  ].filter(Boolean) as string[];
  return { ok: true, message: 'OpenRouter key is valid', details };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => toSettingsResponse(loadSettings()));

  app.put('/api/settings', async (req) => {
    const patch = parse(settingsUpdateSchema, req.body);
    const next = updateSettings(patch);
    clearModelCache();
    return toSettingsResponse(next);
  });

  app.post('/api/settings/reset', async (req) => {
    const { scope } = parse(
      z.object({ scope: z.enum(['providers', 'all']).default('providers') }),
      req.body ?? {},
    );
    const next = resetSettings(scope);
    clearModelCache();
    return toSettingsResponse(next);
  });

  /** Kept for compatibility with the plan: verifies the OpenRouter key. */
  app.post('/api/settings/test-key', async (req) => {
    const body = parse(z.object({ openrouterApiKey: z.string().optional() }), req.body ?? {});
    const s = withOverrides({ target: 'openrouter', openrouterApiKey: body.openrouterApiKey });
    return testOpenRouterKey(resolveOpenRouterKey(s));
  });

  app.post('/api/settings/test-provider', async (req): Promise<TestProviderResult> => {
    const body = parse(testProviderSchema, req.body);
    const s = withOverrides(body);
    try {
      if (body.target === 'openrouter') return await testOpenRouterKey(resolveOpenRouterKey(s));

      const providers = createProviders(s);
      const details: string[] = [];
      if (body.target === 'stt') {
        if (s.stt.provider === 'custom') {
          if (!s.stt.baseUrl)
            return { ok: false, message: 'Enter the base URL of your speech-to-text server' };
          try {
            const ids = await listCompatibleModels(s.stt.baseUrl, s.stt.apiKey);
            details.push(`Server reachable, ${ids.length} model(s) listed`);
            if (ids.length && !ids.includes(s.stt.model))
              details.push(`Note: "${s.stt.model}" is not in the model list`);
          } catch (err) {
            details.push(
              `GET /models failed (${(err as Error).message}); trying a transcription anyway`,
            );
          }
        }
        const t0 = Date.now();
        const r = await providers.stt.transcribe({
          audio: await getTestClip(),
          format: 'mp3',
          model: s.stt.model,
          granularities: ['word', 'segment'],
          signal: AbortSignal.timeout(60_000),
        });
        recordApiCall({
          jobId: null,
          kind: 'test',
          model: s.stt.model,
          requestMs: Date.now() - t0,
          costUsd: r.costUsd ?? 0,
          status: 'ok',
        });
        details.push(`Test clip transcribed in ${Date.now() - t0} ms`);
        details.push(
          r.words.length
            ? 'Word timestamps: supported'
            : r.segments.length
              ? 'Segment timestamps only'
              : 'No timestamps returned for the test tone (normal for silence/tones)',
        );
        return { ok: true, message: `${s.stt.model} works`, details };
      }

      // translation
      if (s.translation.provider === 'custom' && !s.translation.baseUrl) {
        return { ok: false, message: 'Enter the base URL of your chat/LLM server' };
      }
      const withAudio = providers.chat.supportsAudio;
      const t0 = Date.now();
      const content: (
        { type: 'text'; text: string } | { type: 'audio'; data: string; format: 'mp3' }
      )[] = [
        {
          type: 'text',
          text: 'Translate "Good morning, my friend." into Croatian. Answer as JSON {"text": "..."}.',
        },
      ];
      if (withAudio)
        content.push({
          type: 'audio',
          data: (await getTestClip()).toString('base64'),
          format: 'mp3',
        });
      const r = await providers.chat.complete({
        model: s.translation.model,
        messages: [{ role: 'user', content }],
        jsonSchema: {
          name: 'test',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['text'],
            properties: { text: { type: 'string' } },
          },
        },
        temperature: 0,
        maxTokens: 200,
        reasoningEffort: s.reasoningEffort,
        signal: AbortSignal.timeout(60_000),
      });
      recordApiCall({
        jobId: null,
        kind: 'test',
        model: s.translation.model,
        requestMs: Date.now() - t0,
        tokensIn: r.promptTokens,
        tokensOut: r.completionTokens,
        audioTokens: r.audioTokens,
        costUsd: r.costUsd ?? 0,
        status: 'ok',
      });
      details.push(`Answered in ${Date.now() - t0} ms: ${r.content.trim().slice(0, 120)}`);
      details.push(
        withAudio ? 'Audio input: accepted' : 'Audio input: off (gender from text only)',
      );
      return { ok: true, message: `${s.translation.model} works`, details };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  app.get('/api/models', async (req) => {
    const q = parse(
      z.object({
        kind: z.enum(['stt', 'chat']).default('chat'),
        provider: z.enum(['openrouter', 'custom']).optional(),
        baseUrl: z.string().optional(),
        apiKey: z.string().optional(),
      }),
      req.query,
    );
    const s = loadSettings();
    const which = q.kind === 'stt' ? s.stt : s.translation;
    const provider = q.provider ?? which.provider;
    if (provider === 'custom') {
      const baseUrl = q.baseUrl || which.baseUrl;
      const apiKey = q.apiKey && !q.apiKey.includes('•') ? q.apiKey : which.apiKey;
      if (!baseUrl) return { models: [], error: 'No base URL configured' };
      try {
        return { models: await getCustomModels(baseUrl, apiKey) };
      } catch (err) {
        return { models: [], error: (err as Error).message };
      }
    }
    return { models: await getOpenRouterModels(q.kind, s) };
  });

  app.get('/api/health', async () => ({ ok: true, version: config.version }));
}
