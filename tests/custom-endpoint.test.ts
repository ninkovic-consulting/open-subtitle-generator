import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Job, TestProviderResult } from '../src/shared/types.js';
import { buildApp, type App } from '../src/server/app.js';
import { decodeSubtitle, parseSrt } from '../src/server/services/srt.js';
import { freshDb } from './helpers/db.js';
import { makeVideo, tempDir } from './helpers/fixtures.js';
import { startMockOpenAI, type MockOpenAI } from './helpers/mock-openai.js';

let ctx: App;
let mock: MockOpenAI;
let video: string;

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await ctx.app.inject({
    method: method as 'GET',
    url,
    payload: body as object | undefined,
    headers: { host: 'localhost:4747', 'x-osg-token': ctx.token },
  });
  return JSON.parse(res.body) as T;
}

beforeAll(async () => {
  freshDb();
  mock = await startMockOpenAI({ apiKey: 'local-secret', rejectJsonSchema: true });
  ctx = await buildApp({ dev: false, serveWeb: false });
  ctx.queue.start();
  video = await makeVideo(path.join(tempDir(), 'Local Movie'), 'Local.Movie.2024.mp4', {
    seconds: 24,
  });
});

afterAll(async () => {
  await ctx.app.close();
  await mock.close();
});

describe('custom OpenAI-compatible endpoints (local models)', () => {
  it('saves custom endpoints with their own API key', async () => {
    const res = await req<{
      settings: { stt: { provider: string; apiKey: string }; translation: { provider: string } };
    }>('PUT', '/api/settings', {
      stt: {
        provider: 'custom',
        baseUrl: mock.url,
        apiKey: 'local-secret',
        model: 'whisper-local',
      },
      translation: {
        provider: 'custom',
        baseUrl: `${mock.url}/chat/completions`,
        apiKey: 'local-secret',
        model: 'llm-local',
        audioInput: false,
        structuredOutput: true,
      },
    });
    expect(res.settings.stt.provider).toBe('custom');
    expect(res.settings.stt.apiKey).not.toBe('local-secret');
  });

  it('lists models from the custom server', async () => {
    const res = await req<{ models: { id: string }[] }>('GET', '/api/models?kind=stt');
    expect(res.models.map((m) => m.id)).toEqual(['whisper-local', 'llm-local']);
  });

  it('tests both providers', async () => {
    const stt = await req<TestProviderResult>('POST', '/api/settings/test-provider', {
      target: 'stt',
    });
    expect(stt.ok, stt.message).toBe(true);
    const tr = await req<TestProviderResult>('POST', '/api/settings/test-provider', {
      target: 'translation',
    });
    expect(tr.ok, tr.message).toBe(true);
  });

  it('reports a clear error when the server is down', async () => {
    const res = await req<TestProviderResult>('POST', '/api/settings/test-provider', {
      target: 'translation',
      translation: {
        provider: 'custom',
        baseUrl: 'http://127.0.0.1:9/v1',
        model: 'x',
        audioInput: false,
        structuredOutput: true,
      },
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Is the server running|Cannot reach/);
  });

  it('runs a whole job locally without an OpenRouter key', async () => {
    const created = await req<{ jobs: Job[] }>('POST', '/api/jobs', {
      paths: [video],
      targetLang: 'hr',
    });
    await ctx.queue.onIdle();
    const { job } = await req<{ job: Job }>('GET', `/api/jobs/${created.jobs[0]!.id}`);
    expect(job.status, job.error ?? '').toBe('done');
    expect(job.costUsd).toBe(0);
    expect(job.detectedLang).toBe('en'); // "english" from verbose_json normalised to ISO
    const cues = parseSrt(decodeSubtitle(fs.readFileSync(job.outputPath!)).text);
    expect(cues).toHaveLength(4);
    expect(cues[0]!.text).toContain('žđčćš');

    const stt = mock.requests.filter((r) => r.path === '/v1/audio/transcriptions');
    expect(stt.length).toBeGreaterThan(0);
    expect(stt.every((r) => r.auth === 'Bearer local-secret')).toBe(true);
    expect(stt[0]!.contentType).toContain('multipart/form-data');
    // json_schema was rejected once, then OSG fell back and kept going.
    const chat = mock.requests.filter((r) => r.path === '/v1/chat/completions');
    expect(chat.some((r) => r.body.includes('"json_schema"'))).toBe(true);
    expect(chat.some((r) => r.body.includes('"json_object"'))).toBe(true);
    // Audio input was off for this endpoint, so no audio parts were sent.
    expect(chat.every((r) => !r.body.includes('input_audio'))).toBe(true);
  });

  it('resets providers back to OpenRouter defaults', async () => {
    const res = await req<{
      settings: {
        stt: { provider: string; model: string };
        translation: { provider: string; model: string };
      };
    }>('POST', '/api/settings/reset', { scope: 'providers' });
    expect(res.settings.stt).toMatchObject({
      provider: 'openrouter',
      model: 'qwen/qwen3-asr-1.7b',
    });
    expect(res.settings.translation).toMatchObject({
      provider: 'openrouter',
      model: 'google/gemini-3.1-flash-lite',
    });
  });
});
