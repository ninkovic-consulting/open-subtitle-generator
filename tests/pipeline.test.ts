import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Job, SubtitlePair } from '../src/shared/types.js';
import { buildApp, type App } from '../src/server/app.js';
import { setProviderFactory } from '../src/server/providers/index.js';
import { decodeSubtitle, parseSrt } from '../src/server/services/srt.js';
import { freshDb } from './helpers/db.js';
import { fakeChat, fakeStt, type FakeLog } from './helpers/fakes.js';
import { makeVideo, tempDir } from './helpers/fixtures.js';

const EMBEDDED = `1
00:00:01,000 --> 00:00:03,000
Where were you?

2
00:00:04,000 --> 00:00:06,000
At the harbor.

3
00:00:07,000 --> 00:00:09,500
<i>The storm is coming.</i>

4
00:00:10,000 --> 00:00:12,000
Then we stay.
`;

let ctx: App;
let dir: string;
let ep1: string;
let ep2: string;
const calls: FakeLog = { stt: [], chat: [] };

async function req<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: T }> {
  const res = await ctx.app.inject({
    method: method as 'GET',
    url,
    payload: body as object | undefined,
    headers: { host: '127.0.0.1:4747', 'x-osg-token': ctx.token, ...headers },
  });
  return { status: res.statusCode, json: (res.body ? JSON.parse(res.body) : null) as T };
}

async function runJobs(body: object): Promise<Job[]> {
  const res = await req<{ jobs: Job[] }>('POST', '/api/jobs', body);
  expect(res.status).toBe(200);
  await ctx.queue.onIdle();
  return Promise.all(
    res.json.jobs.map(async (j) => (await req<{ job: Job }>('GET', `/api/jobs/${j.id}`)).json.job),
  );
}

beforeAll(async () => {
  freshDb();
  setProviderFactory(() => ({ stt: fakeStt(calls, { seconds: 30 }), chat: fakeChat(calls) }));
  ctx = await buildApp({ dev: false, serveWeb: false });
  ctx.queue.start();
  dir = path.join(tempDir(), 'My Show', 'Season 1');
  ep1 = await makeVideo(dir, 'My.Show.S01E01.mp4', { seconds: 30 });
  ep2 = await makeVideo(dir, 'My.Show.S01E02.mkv', { seconds: 15, embeddedSrt: EMBEDDED });
});

afterAll(async () => {
  setProviderFactory(null);
  await ctx.app.close();
});

describe('security', () => {
  it('requires the session token', async () => {
    expect((await req('GET', '/api/settings', undefined, { 'x-osg-token': '' })).status).toBe(401);
    expect((await req('GET', '/api/settings', undefined, { 'x-osg-token': 'wrong' })).status).toBe(
      401,
    );
    expect((await req('GET', '/api/settings')).status).toBe(200);
    expect((await req('GET', '/api/health', undefined, { 'x-osg-token': '' })).status).toBe(200);
  });
  it('rejects foreign hosts and origins', async () => {
    expect(
      (await req('GET', '/api/settings', undefined, { host: 'evil.example:4747' })).status,
    ).toBe(403);
    expect(
      (await req('GET', '/api/settings', undefined, { origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect(
      (await req('GET', '/api/settings', undefined, { origin: 'http://localhost:5173' })).status,
    ).toBe(200);
  });
  it('never returns the API key in clear text', async () => {
    await req('PUT', '/api/settings', { openrouterApiKey: 'sk-or-v1-secret-value-123456' });
    const res = await req<{ settings: { openrouterApiKey: string } }>('GET', '/api/settings');
    expect(res.json.settings.openrouterApiKey).not.toContain('secret-value');
  });
  it('only lists folders, videos and subtitles', async () => {
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    const res = await req<{ entries: { name: string; type: string }[] }>(
      'GET',
      `/api/fs/list?path=${encodeURIComponent(dir)}`,
    );
    expect(res.json.entries.map((e) => e.name)).not.toContain('notes.txt');
    expect(res.json.entries.filter((e) => e.type === 'video')).toHaveLength(2);
  });
});

describe('pipeline', () => {
  it('estimates cost and picks the timing source', async () => {
    const res = await req<{ files: { fileName: string; timingSource: string }[] }>(
      'POST',
      '/api/jobs/estimate',
      { paths: [ep1, ep2], options: {}, targetLang: 'hr' },
    );
    expect(res.json.files.map((f) => f.timingSource)).toEqual(['stt', 'embedded_srt']);
  });

  it('transcribes, translates and writes Episode.hr.srt next to the video', async () => {
    const [job] = await runJobs({ paths: [ep1], targetLang: 'hr', sourceLang: 'auto' });
    expect(job!.status, job!.error ?? '').toBe('done');
    expect(job!.timingSource).toBe('stt');
    expect(job!.detectedLang).toBe('en');
    const out = path.join(dir, 'My.Show.S01E01.hr.srt');
    expect(job!.outputPath).toBe(out);
    const buf = fs.readFileSync(out);
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const decoded = decodeSubtitle(buf);
    expect(decoded.encoding).toBe('utf-8-bom');
    expect(decoded.text).toContain('\r\n');
    const cues = parseSrt(decoded.text);
    expect(cues).toHaveLength(5); // "Thanks for watching!" was filtered out
    expect(cues.every((c) => c.text.includes('čćđšž'))).toBe(true);
    for (let i = 1; i < cues.length; i++)
      expect(cues[i]!.startMs).toBeGreaterThan(cues[i - 1]!.endMs);

    // Word timestamps were requested, audio was attached to the translation batch.
    expect(calls.stt[0]!.granularities).toContain('word');
    const translateReq = calls.chat.find((c) => c.jsonSchema?.name === 'subtitle_batch')!;
    expect(
      (translateReq.messages[1]!.content as { type: string }[]).some((p) => p.type === 'audio'),
    ).toBe(true);

    // Costs add up.
    const callsRes = await req<{ calls: { costUsd: number }[] }>(
      'GET',
      `/api/jobs/${job!.id}/calls`,
    );
    const sum = callsRes.json.calls.reduce((s, c) => s + c.costUsd, 0);
    expect(job!.costUsd).toBeCloseTo(sum, 6);
    expect(job!.costUsd).toBeGreaterThan(0);

    // Glossary from the context pass is stored on the project.
    const g = await req<{ glossary: { characters: { name: string }[] } }>(
      'GET',
      `/api/glossary/${job!.projectId}`,
    );
    expect(g.json.glossary.characters[0]!.name).toBe('Ana');

    // Source and translation are both stored for the editor.
    const subs = await req<SubtitlePair>('GET', `/api/jobs/${job!.id}/subtitles`);
    expect(subs.json.source!.cues).toHaveLength(5);
    expect(subs.json.translated!.cues[0]!.sourceCueId).toBe(subs.json.source!.cues[0]!.id);
  });

  it('uses the embedded subtitle track and skips speech-to-text', async () => {
    const before = calls.stt.length;
    const [job] = await runJobs({ paths: [ep2], targetLang: 'hr' });
    expect(job!.status, job!.error ?? '').toBe('done');
    expect(job!.timingSource).toBe('embedded_srt');
    expect(calls.stt.length).toBe(before);
    const cues = parseSrt(
      decodeSubtitle(fs.readFileSync(path.join(dir, 'My.Show.S01E02.hr.srt'))).text,
    );
    // Muxing the fixture shifts the track by the AAC priming delay (1024 samples @ 16 kHz = 64 ms).
    [1000, 4000, 7000, 10000].forEach((ms, i) =>
      expect(Math.abs(cues[i]!.startMs - ms)).toBeLessThanOrEqual(100),
    );
    const subs = await req<SubtitlePair>('GET', `/api/jobs/${job!.id}/subtitles`);
    expect(subs.json.source!.cues[2]!.text).toBe('<i>The storm is coming.</i>');
  });

  it('stops before paid requests when the output exists and overwrite is off', async () => {
    const chatBefore = calls.chat.length;
    const sttBefore = calls.stt.length;
    const [job] = await runJobs({ paths: [ep1], targetLang: 'hr' });
    expect(job!.status).toBe('failed');
    expect(job!.error).toContain('already exists');
    expect(calls.chat.length).toBe(chatBefore);
    expect(calls.stt.length).toBe(sttBefore);
  });

  it('re-translates into another language without new speech-to-text', async () => {
    const first = (await req<{ jobs: Job[] }>('GET', '/api/jobs?status=done')).json.jobs.find(
      (j) => j.timingSource === 'stt',
    )!;
    const sttBefore = calls.stt.length;
    const res = await req<{ job: Job }>('POST', `/api/jobs/${first.id}/retranslate`, {
      targetLang: 'de',
    });
    await ctx.queue.onIdle();
    const job = (await req<{ job: Job }>('GET', `/api/jobs/${res.json.job.id}`)).json.job;
    expect(job.status, job.error ?? '').toBe('done');
    expect(calls.stt.length).toBe(sttBefore);
    expect(fs.existsSync(path.join(dir, 'My.Show.S01E01.de.srt'))).toBe(true);
  });

  it('edits a cue and exports it in a legacy code page', async () => {
    const job = (await req<{ jobs: Job[] }>('GET', '/api/jobs?status=done')).json.jobs.find(
      (j) => j.targetLang === 'hr' && j.timingSource === 'stt',
    )!;
    const subs = await req<SubtitlePair>('GET', `/api/jobs/${job.id}/subtitles`);
    const cue = subs.json.translated!.cues[0]!;
    const patched = await req<{ cue: { text: string; edited: boolean } }>(
      'PATCH',
      `/api/cues/${cue.id}`,
      { text: 'Gdje si bio, Đuro?' },
    );
    expect(patched.json.cue.edited).toBe(true);
    const exp = await req<{ path: string; encoding: string }>(
      'POST',
      `/api/jobs/${job.id}/export`,
      { encoding: 'legacy', overwrite: true },
    );
    expect(exp.json.encoding).toBe('cp1250');
    const text = iconv.decode(fs.readFileSync(exp.json.path), 'cp1250');
    expect(text).toContain('Gdje si bio, Đuro?');
  });

  it('cancels queued jobs', async () => {
    const res = await req<{ jobs: Job[] }>('POST', '/api/jobs', { paths: [ep2], targetLang: 'fr' });
    const id = res.json.jobs[0]!.id;
    await req('DELETE', `/api/jobs/${id}`);
    await ctx.queue.onIdle();
    const job = (await req<{ job: Job }>('GET', `/api/jobs/${id}`)).json.job;
    expect(['cancelled', 'done']).toContain(job.status);
  });

  it('reports stats', async () => {
    const res = await req<{
      totalUsd: number;
      jobCounts: Record<string, number>;
      byModel: unknown[];
    }>('GET', '/api/stats');
    expect(res.json.totalUsd).toBeGreaterThan(0);
    expect(res.json.jobCounts.done).toBeGreaterThanOrEqual(3);
    expect(res.json.byModel.length).toBeGreaterThan(0);
  });
});

describe('own outputs are not existing subtitles', () => {
  it('does not offer OSG-generated files as timing source', async () => {
    const files = await req<{ files: { fileName: string; sidecarSubtitles: string[] }[] }>(
      'GET',
      `/api/projects/${(await req<{ jobs: Job[] }>('GET', '/api/jobs')).json.jobs[0]!.projectId}/files`,
    );
    const ep = files.json.files.find((f) => f.fileName === 'My.Show.S01E01.mp4')!;
    expect(ep.sidecarSubtitles).toEqual([]);
    const est = await req<{ files: { timingSource: string }[] }>('POST', '/api/jobs/estimate', {
      paths: [ep1],
      options: {},
      targetLang: 'fr',
    });
    expect(est.json.files[0]!.timingSource).toBe('stt');
  });
});

describe('stage order and progress logs', () => {
  it('prepares audio before the character pass and logs translation progress', async () => {
    const job = (await req<{ jobs: Job[] }>('GET', '/api/jobs?status=done')).json.jobs.find(
      (j) => j.timingSource === 'embedded_srt',
    )!;
    const logs = (
      await req<{ logs: { stage: string | null; message: string }[] }>(
        'GET',
        `/api/jobs/${job.id}/logs`,
      )
    ).json.logs;
    const at = (re: RegExp) => logs.findIndex((l) => re.test(l.message));
    expect(at(/^Extracting audio/)).toBeGreaterThan(-1);
    expect(at(/^Extracting audio/)).toBeLessThan(at(/^Context pass/));
    expect(at(/^Translating \d+ lines in/)).toBeGreaterThan(at(/^Context pass/));
  });
});

describe('deleting subtitles', () => {
  it('deletes the file but keeps the translation when asked', async () => {
    const job = (await req<{ jobs: Job[] }>('GET', '/api/jobs?status=done')).json.jobs.find(
      (j) => j.timingSource === 'embedded_srt' && j.targetLang === 'hr',
    )!;
    expect(fs.existsSync(job.outputPath!)).toBe(true);
    const res = await req<{ deletedFile: string; jobRemoved: boolean }>(
      'DELETE',
      `/api/jobs/${job.id}/subtitle?keepJob=1`,
    );
    expect(res.json.jobRemoved).toBe(false);
    expect(fs.existsSync(res.json.deletedFile)).toBe(false);
    const after = (await req<{ job: Job }>('GET', `/api/jobs/${job.id}`)).json.job;
    expect(after.outputPath).toBeNull();
    // Saving again from the editor writes the file back.
    const exp = await req<{ path: string }>('POST', `/api/jobs/${job.id}/export`, {});
    expect(fs.existsSync(exp.json.path)).toBe(true);
  });

  it('deletes the file and removes the job from history', async () => {
    const job = (await req<{ jobs: Job[] }>('GET', '/api/jobs?status=done')).json.jobs.find(
      (j) => j.targetLang === 'de',
    )!;
    const out = job.outputPath!;
    const res = await req<{ deletedFile: string; jobRemoved: boolean }>(
      'DELETE',
      `/api/jobs/${job.id}/subtitle`,
    );
    expect(res.json).toEqual({ deletedFile: out, jobRemoved: true });
    expect(fs.existsSync(out)).toBe(false);
    expect((await req('GET', `/api/jobs/${job.id}`)).status).toBe(404);
    expect(fs.existsSync(ep1)).toBe(true); // the video is never touched
  });
});

describe('file search', () => {
  it('finds folders and videos in subfolders, ignoring case and accents', async () => {
    const root = tempDir();
    const season = path.join(root, 'Šuma', 'Sezona 1');
    fs.mkdirSync(season, { recursive: true });
    fs.writeFileSync(path.join(season, 'Čarobnjak.S01E01.mkv'), '');
    fs.writeFileSync(path.join(season, 'Čarobnjak.S01E01.srt'), '');
    fs.writeFileSync(path.join(root, 'notes.txt'), '');
    const q = (s: string) =>
      req<{ entries: { name: string; type: string; relativeDir: string }[] }>(
        'GET',
        `/api/fs/search?path=${encodeURIComponent(root)}&q=${encodeURIComponent(s)}`,
      );
    const videos = (await q('carobnjak s01')).json.entries;
    expect(videos).toEqual([
      expect.objectContaining({
        name: 'Čarobnjak.S01E01.mkv',
        type: 'video',
        relativeDir: path.join('Šuma', 'Sezona 1'),
      }),
    ]);
    const dirs = (await q('SUMA')).json.entries;
    expect(dirs.map((d) => [d.name, d.type])).toEqual([['Šuma', 'dir']]);
    expect((await q('notes')).json.entries).toEqual([]);
  });
});
