import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { languageName } from '../../shared/languages.js';
import { EMPTY_GLOSSARY, type Cue } from '../../shared/types.js';
import { config } from '../config.js';
import { getDb, schema } from '../db/client.js';
import { createProviders, isAbortError } from '../providers/index.js';
import { costFromUsage } from './cost.js';
import { jobLogger, recordApiCall } from './joblog.js';
import { chooseAudioTrack, encodeMp3, extractAudio, probe } from './media.js';
import { getModelPricing } from './models.js';
import {
  addJobCost,
  getGlossary,
  getJob,
  getMediaFile,
  getSubtitle,
  toCue,
  updateJob,
} from './repo.js';
import { loadSettings } from './settings.js';
import { translateCues, type SourceCue } from './translate.js';

/** Re-translates selected translated cues in place (with surrounding context and optional audio). */
export async function retranslateCuesInPlace(
  jobId: number,
  cueIds: number[],
  modelOverride?: string,
): Promise<Cue[]> {
  const job = getJob(jobId);
  if (!job) throw new Error('Job not found');
  const media = getMediaFile(job.mediaFileId);
  const source = getSubtitle(jobId, 'source');
  const translated = getSubtitle(jobId, 'translated');
  if (!media || !source || !translated) throw new Error('This job has no subtitles yet');
  const settings = loadSettings();
  const providers = createProviders(settings);
  const model = modelOverride || job.translateModel || settings.translation.model;
  const log = jobLogger(jobId, () => 'translate');

  const sourceById = new Map(source.cues.map((c) => [c.id, c]));
  const wanted = new Set(cueIds);
  const pairs = translated.cues
    .filter((t) => wanted.has(t.id) && t.sourceCueId !== null && sourceById.has(t.sourceCueId))
    .map((t) => ({ t, s: sourceById.get(t.sourceCueId!)! }));
  if (!pairs.length) return [];

  const all: SourceCue[] = source.cues.map((c) => ({
    id: c.idx,
    startMs: c.startMs,
    endMs: c.endMs,
    text: c.text,
  }));
  const targets = pairs.map(({ s }) => ({
    id: s.idx,
    startMs: s.startMs,
    endMs: s.endMs,
    text: s.text,
  }));

  const useVoice =
    (job.options.useVoiceForGender ?? settings.useVoiceForGender) &&
    providers.chat.supportsAudio &&
    fs.existsSync(media.path);
  const tmpDir = path.join(config.dataDir, 'tmp', `retranslate-${jobId}-${Date.now()}`);
  let wav: string | null = null;
  const controller = new AbortController();
  try {
    if (useVoice) {
      try {
        const info = await probe(media.path);
        const track = chooseAudioTrack(info.audioTracks, job.sourceLang, job.options.audioTrack);
        if (track) {
          fs.mkdirSync(tmpDir, { recursive: true });
          wav = path.join(tmpDir, 'work.wav');
          await extractAudio(media.path, track.index, wav, controller.signal);
        }
      } catch (err) {
        if (isAbortError(err)) throw err;
        wav = null;
      }
    }
    const pricing =
      settings.translation.provider === 'custom' ? null : await getModelPricing(model, 'chat');
    const projectGlossary = media.projectId ? getGlossary(media.projectId) : EMPTY_GLOSSARY;
    log('info', `Re-translating ${targets.length} selected cue(s) with ${model}`);
    const items = await translateCues({
      all,
      targets,
      targetLanguage: job.options.targetLangName || languageName(job.targetLang),
      sourceLanguage: job.detectedLang ? languageName(job.detectedLang) : null,
      glossary: projectGlossary,
      chat: providers.chat,
      model,
      batchSize: Math.min(settings.batchSize, 40),
      concurrency: settings.translateConcurrency,
      useAudio: !!wav,
      loadAudio: wav ? (s, e) => encodeMp3(wav!, s, e) : undefined,
      reasoningEffort: settings.reasoningEffort,
      temperature: Math.min(1, settings.temperature + 0.2),
      log,
      onCall: (c) => {
        const cost = c.ok
          ? settings.translation.provider === 'custom'
            ? (c.costUsd ?? 0)
            : (c.costUsd ?? costFromUsage(pricing, c))
          : 0;
        recordApiCall({
          jobId,
          kind: 'translate',
          model,
          requestMs: c.ms,
          tokensIn: c.promptTokens,
          tokensOut: c.completionTokens,
          audioTokens: c.audioTokens,
          costUsd: cost,
          status: c.ok ? 'ok' : 'error',
          error: c.error,
        });
        addJobCost(jobId, {
          costUsd: cost,
          tokensIn: c.promptTokens,
          tokensOut: c.completionTokens,
        });
      },
    });
    const db = getDb();
    const updated: Cue[] = [];
    db.transaction((tx) => {
      for (const { t, s } of pairs) {
        const item = items.get(s.idx);
        if (!item || item.fallback) continue;
        const row = tx
          .update(schema.cues)
          .set({ text: item.text, speakerGender: item.gender, edited: 0 })
          .where(eq(schema.cues.id, t.id))
          .returning()
          .get();
        if (row) updated.push(toCue(row));
      }
    });
    updateJob(jobId, {});
    return updated;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
