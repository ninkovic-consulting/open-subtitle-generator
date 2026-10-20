import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { findLanguage, languageName, sttLanguageHint } from '../../shared/languages.js';
import { EMPTY_GLOSSARY, type JobStage, type Settings } from '../../shared/types.js';
import { config } from '../config.js';
import { getDb, schema } from '../db/client.js';
import { createProviders, isAbortError } from '../providers/index.js';
import { planChunks } from './chunker.js';
import { runContextPass } from './context.js';
import { costFromUsage } from './cost.js';
import { buildCues } from './cues.js';
import { jobLogger, recordApiCall, type JobLogger } from './joblog.js';
import {
  chooseAudioTrack,
  detectSilences,
  encodeMp3,
  extractAudio,
  extractEmbeddedSubtitle,
  probe,
  type ProbeResult,
} from './media.js';
import { getModelPricing } from './models.js';
import {
  addJobCost,
  deleteSubtitles,
  externalSidecars,
  getGlossary,
  getJob,
  getMediaFile,
  getSubtitle,
  saveGlossary,
  saveSubtitle,
  updateJob,
  type NewCue,
} from './repo.js';
import { loadSettings } from './settings.js';
import { decodeSubtitle, parseSrt, type SrtCue } from './srt.js';
import { transcribeChunks } from './stt.js';
import { translateCues, type SourceCue } from './translate.js';
import { outputPathFor, writeSubtitleFile } from './writer.js';

const STAGE_PROGRESS: Record<JobStage, number> = {
  probe: 0.01,
  extract: 0.04,
  transcribe: 0.1,
  context: 0.5,
  translate: 0.55,
  write: 0.97,
};

interface SourceResult {
  cues: SrtCue[];
  timingSource: 'stt' | 'sidecar_srt' | 'embedded_srt';
  detectedLang: string | null;
  protectedPath?: string;
}

function isoOf(lang: string | null | undefined): string | null {
  if (!lang || lang === 'auto') return null;
  return findLanguage(lang)?.iso ?? lang.split('-')[0]!.toLowerCase();
}

/** Picks a sidecar or embedded text subtitle to use as the timing source. */
async function existingSubtitleSource(
  mediaFileId: number,
  videoPath: string,
  info: ProbeResult,
  sourceLang: string,
  targetLang: string,
  outPath: string,
  log: JobLogger,
  signal: AbortSignal,
): Promise<SourceResult | null> {
  const targetIso = isoOf(targetLang);
  const sourceIso = isoOf(sourceLang);
  const sidecars = externalSidecars(videoPath, mediaFileId).filter(
    (s) =>
      path.resolve(s.path) !== path.resolve(outPath) &&
      (s.language === null || s.language !== targetIso),
  );
  const rank = (lang: string | null) =>
    sourceIso && lang === sourceIso ? 0 : lang === null ? 1 : 2;
  sidecars.sort((a, b) => rank(a.language) - rank(b.language));
  for (const s of sidecars) {
    try {
      const decoded = decodeSubtitle(fs.readFileSync(s.path));
      const cues = parseSrt(decoded.text);
      if (cues.length >= 3) {
        log(
          'info',
          `Using sidecar subtitle ${path.basename(s.path)} (${cues.length} cues, ${decoded.encoding}) as timing source`,
        );
        return {
          cues,
          timingSource: 'sidecar_srt',
          detectedLang: s.language,
          protectedPath: s.path,
        };
      }
    } catch (err) {
      log('warn', `Could not read ${path.basename(s.path)}: ${(err as Error).message}`);
    }
  }
  const tracks = info.subtitleTracks.filter(
    (t) => t.textBased && (t.language === null || t.language !== targetIso),
  );
  tracks.sort((a, b) => rank(a.language) - rank(b.language));
  const imageTracks = info.subtitleTracks.filter((t) => !t.textBased);
  for (const t of tracks) {
    try {
      const buf = await extractEmbeddedSubtitle(videoPath, t.index, signal);
      const cues = parseSrt(decodeSubtitle(buf).text);
      if (cues.length >= 3) {
        log(
          'info',
          `Using embedded subtitle track #${t.index} (${t.codec}, ${t.language ?? 'unknown language'}, ${cues.length} cues) as timing source`,
        );
        return { cues, timingSource: 'embedded_srt', detectedLang: t.language };
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      log('warn', `Could not extract subtitle track #${t.index}: ${(err as Error).message}`);
    }
  }
  if (imageTracks.length) {
    log(
      'info',
      `Skipping ${imageTracks.length} image-based subtitle track(s) (${imageTracks.map((t) => t.codec).join(', ')}); OCR is not supported`,
    );
  }
  return null;
}

export async function runPipeline(jobId: number, signal: AbortSignal): Promise<void> {
  const settings: Settings = loadSettings();
  const initial = getJob(jobId);
  if (!initial) throw new Error(`Job ${jobId} not found`);
  const media = getMediaFile(initial.mediaFileId);
  if (!media) throw new Error('Media file not found');
  const opts = initial.options;
  let stage: JobStage = 'probe';
  const log = jobLogger(jobId, () => stage);
  const providers = createProviders(settings);
  const tmpDir = path.join(config.dataDir, 'tmp', `job-${jobId}`);

  const sttModel = opts.sttModel || settings.stt.model;
  const translateModel = opts.translateModel || settings.translation.model;
  const encoding = opts.encoding ?? settings.encoding;
  const naming = opts.naming ?? settings.naming;
  const overwrite = opts.overwrite ?? settings.overwrite;
  const useExisting = opts.useExistingSubtitles ?? settings.useExistingSubtitles;
  const wantVoice = opts.useVoiceForGender ?? settings.useVoiceForGender;
  const useVoice = wantVoice && providers.chat.supportsAudio;
  const targetName = opts.targetLangName || languageName(initial.targetLang);
  const batchSize = opts.batchSize ?? settings.batchSize;
  const reasoningEffort = opts.reasoningEffort ?? settings.reasoningEffort;
  const sttIsCustom = settings.stt.provider === 'custom';
  const chatIsCustom = settings.translation.provider === 'custom';

  let lastProgressAt = 0;
  const setStage = (s: JobStage) => {
    stage = s;
    updateJob(jobId, { stage: s, progress: STAGE_PROGRESS[s] });
  };
  const setProgress = (p: number, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 400) return;
    lastProgressAt = now;
    updateJob(jobId, { progress: Math.min(0.99, Math.max(0, p)) });
  };

  updateJob(jobId, {
    status: 'running',
    error: null,
    finishedAt: null,
    startedAt: initial.startedAt ?? Date.now(),
    translateModel,
  });
  log('info', `Starting: ${media.fileName} → ${targetName}`, {
    stt: `${settings.stt.provider}:${sttModel}`,
    translation: `${settings.translation.provider}:${translateModel}`,
  });

  // "Retry from stage": drop results from that stage onwards.
  if (opts.fromStage) {
    if (
      opts.fromStage === 'probe' ||
      opts.fromStage === 'extract' ||
      opts.fromStage === 'transcribe'
    )
      deleteSubtitles(jobId, ['source', 'translated']);
    else if (opts.fromStage === 'context' || opts.fromStage === 'translate')
      deleteSubtitles(jobId, ['translated']);
    const { fromStage: _drop, ...rest } = opts;
    getDb().update(schema.jobs).set({ options: rest }).where(eq(schema.jobs.id, jobId)).run();
    log('info', `Retrying from stage "${opts.fromStage}"`);
  }

  let wavPath: string | null = null;
  try {
    // 1. Probe ---------------------------------------------------------------
    setStage('probe');
    if (!fs.existsSync(media.path)) throw new Error(`Video file not found: ${media.path}`);
    const info = await probe(media.path, signal);
    getDb()
      .update(schema.mediaFiles)
      .set({
        durationSec: info.durationSec,
        audioTracks: info.audioTracks,
        subtitleTracks: info.subtitleTracks,
        sizeBytes: fs.statSync(media.path).size,
      })
      .where(eq(schema.mediaFiles.id, media.id))
      .run();
    const duration = info.durationSec ?? 0;
    log(
      'info',
      `Probed: ${duration >= 120 ? `${Math.round(duration / 60)} min` : `${Math.round(duration)} s`}, ${info.audioTracks.length} audio track(s), ${info.subtitleTracks.length} subtitle track(s)`,
    );

    const outPath = outputPathFor(media.path, initial.targetLang, naming);
    /** Fails early (before paid API calls) when the output exists and overwrite is off. */
    const assertWritable = (protectedP?: string) => {
      let p = outPath;
      if (protectedP && path.resolve(protectedP).toLowerCase() === path.resolve(p).toLowerCase())
        p = p.replace(/\.srt$/i, '.osg.srt');
      if (fs.existsSync(p) && !overwrite) {
        throw new Error(
          `Subtitle already exists: ${path.basename(p)}. Enable "Overwrite existing subtitles" to replace it.`,
        );
      }
    };

    const ensureWav = async (): Promise<string> => {
      if (wavPath) return wavPath;
      const prev = stage;
      setStage('extract');
      const track = chooseAudioTrack(info.audioTracks, initial.sourceLang, opts.audioTrack);
      if (!track) throw new Error('This file has no audio track');
      fs.mkdirSync(tmpDir, { recursive: true });
      const out = path.join(tmpDir, 'work.wav');
      if (!fs.existsSync(out)) {
        log(
          'info',
          `Extracting audio track #${track.index} (${track.codec}, ${track.language ?? 'unknown language'}, ${track.channels} ch)`,
        );
        const t0 = Date.now();
        await extractAudio(media.path, track.index, out, signal);
        log('info', `Audio ready in ${Math.max(1, Math.round((Date.now() - t0) / 1000))} s`);
      }
      wavPath = out;
      if (prev !== 'extract') stage = prev;
      return out;
    };

    // 2. Source cues ---------------------------------------------------------
    let source = getSubtitle(jobId, 'source');
    let protectedPath: string | undefined;
    if (source && source.cues.length) {
      log('info', `Resuming with ${source.cues.length} source cues from the previous run`);
    } else {
      let result: SourceResult | null = null;
      if (opts.reuseSourceFromJobId) {
        const prevJob = getJob(opts.reuseSourceFromJobId);
        const prev = getSubtitle(opts.reuseSourceFromJobId, 'source');
        if (prev && prev.cues.length) {
          result = {
            cues: prev.cues.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text })),
            timingSource: prevJob?.timingSource ?? 'stt',
            detectedLang: prevJob?.detectedLang ?? prev.language,
          };
          log(
            'info',
            `Re-using ${prev.cues.length} source cues from job #${opts.reuseSourceFromJobId} (no new transcription)`,
          );
        }
      }
      if (!result && useExisting) {
        result = await existingSubtitleSource(
          media.id,
          media.path,
          info,
          initial.sourceLang,
          initial.targetLang,
          outPath,
          log,
          signal,
        );
      }
      if (!result) {
        assertWritable();
        const wav = await ensureWav();
        setStage('transcribe');
        const silences = await detectSilences(wav, signal);
        const chunks = planChunks(duration, silences, { targetSec: settings.chunkSeconds });
        log(
          'info',
          `Planned ${chunks.length} chunk(s) at silences (${silences.length} silences detected)`,
        );
        const sttPricing = sttIsCustom ? null : await getModelPricing(sttModel, 'stt');
        const parallel = Math.min(settings.sttConcurrency, chunks.length);
        log(
          'info',
          `Transcribing ${Math.round(duration / 60)} min of audio with ${sttModel}: ${chunks.length} chunk(s), ${parallel} at a time. Each chunk takes about 30–60 s.`,
        );
        const tr = await transcribeChunks({
          chunks,
          loadChunk: (c) => encodeMp3(wav, c.start, c.end, signal),
          provider: providers.stt,
          model: sttModel,
          fallbackModel: sttIsCustom ? undefined : settings.stt.fallbackModel || undefined,
          language: sttLanguageHint(initial.sourceLang),
          concurrency: settings.sttConcurrency,
          signal,
          log,
          onCall: (c) => {
            const pricing = c.model === sttModel ? sttPricing : null;
            const cost = sttIsCustom ? 0 : (c.costUsd ?? (pricing?.promptPrice ?? 0) * c.seconds);
            recordApiCall({
              jobId,
              kind: 'stt',
              model: c.model,
              requestMs: c.ms,
              costUsd: c.ok ? cost : 0,
              status: c.ok ? 'ok' : 'error',
              error: c.error,
            });
            if (c.ok) addJobCost(jobId, { costUsd: cost, audioSeconds: c.seconds });
          },
          onChunkDone: (d, t) => setProgress(0.1 + 0.38 * (d / t), true),
        });
        const cues = buildCues(tr.segments, tr.words, duration);
        if (cues.length === 0)
          throw new Error(
            'No speech was detected in the audio track. Try another audio track or check the source language.',
          );
        log(
          'info',
          `Built ${cues.length} cues from ${tr.segments.length} segments${tr.usedWordTimestamps ? ' (word timestamps)' : ' (segment timestamps)'}`,
        );
        result = { cues, timingSource: 'stt', detectedLang: tr.detectedLang };
        updateJob(jobId, { sttModel });
      }
      protectedPath = result.protectedPath;
      const lang =
        result.detectedLang ?? (initial.sourceLang === 'auto' ? 'und' : initial.sourceLang);
      saveSubtitle(jobId, 'source', lang, result.cues);
      updateJob(jobId, { timingSource: result.timingSource, detectedLang: result.detectedLang });
      source = getSubtitle(jobId, 'source');
    }
    if (!source || !source.cues.length) throw new Error('No source cues available');
    if (!protectedPath && getJob(jobId)?.timingSource === 'sidecar_srt') {
      protectedPath = externalSidecars(media.path, media.id).find(
        (s) => path.resolve(s.path) !== path.resolve(outPath),
      )?.path;
    }
    setProgress(0.5, true);

    // 3–4. Context + translation --------------------------------------------
    const existingTranslation = getSubtitle(jobId, 'translated');
    if (!existingTranslation || existingTranslation.cues.length !== source.cues.length) {
      assertWritable(protectedPath);
      const job = getJob(jobId)!;
      const chatPricing = chatIsCustom ? null : await getModelPricing(translateModel, 'chat');
      const chatCost = (u: {
        promptTokens: number;
        completionTokens: number;
        audioTokens: number;
        costUsd: number | null;
      }) => (chatIsCustom ? (u.costUsd ?? 0) : (u.costUsd ?? costFromUsage(chatPricing, u)));

      // Audio for voice-based gender is prepared before the character pass, so the stages run in
      // the order the timeline shows (Audio → Characters → Translate).
      if (wantVoice && !providers.chat.supportsAudio) {
        log(
          'info',
          'Voice-based gender is off: the custom translation endpoint is configured without audio input',
        );
      }
      const wav = useVoice
        ? await ensureWav().catch((err) => {
            if (isAbortError(err)) throw err;
            log('warn', `Audio not available for gender detection: ${(err as Error).message}`);
            return null;
          })
        : null;

      setStage('context');
      const projectId = media.projectId;
      let glossary = projectId ? getGlossary(projectId) : structuredClone(EMPTY_GLOSSARY);
      glossary = await runContextPass({
        lines: source.cues.map((c) => ({ startMs: c.startMs, text: c.text })),
        existing: glossary,
        targetLanguage: targetName,
        chat: providers.chat,
        model: translateModel,
        reasoningEffort,
        signal,
        log,
        onCall: (c) => {
          const cost = c.ok ? chatCost(c) : 0;
          recordApiCall({
            jobId,
            kind: 'context',
            model: translateModel,
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
      if (projectId) saveGlossary(projectId, glossary);

      setStage('translate');
      const sourceCues: SourceCue[] = source.cues.map((c) => ({
        id: c.idx,
        startMs: c.startMs,
        endMs: c.endMs,
        text: c.text,
      }));
      const sourceLanguage = job.detectedLang
        ? languageName(job.detectedLang)
        : initial.sourceLang === 'auto'
          ? null
          : languageName(initial.sourceLang);
      const items = await translateCues({
        all: sourceCues,
        // Lines from speech-to-text may be invented; let the model drop short ones it cannot hear.
        verifySpeech: job.timingSource === 'stt',
        targetLanguage: targetName,
        sourceLanguage,
        glossary,
        chat: providers.chat,
        model: translateModel,
        batchSize,
        concurrency: settings.translateConcurrency,
        useAudio: !!wav,
        loadAudio: wav ? (s, e) => encodeMp3(wav, s, e, signal) : undefined,
        reasoningEffort,
        temperature: settings.temperature,
        signal,
        log,
        onCall: (c) => {
          const cost = c.ok ? chatCost(c) : 0;
          recordApiCall({
            jobId,
            kind: 'translate',
            model: translateModel,
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
        onProgress: (d, t) => setProgress(0.55 + 0.4 * (d / Math.max(1, t))),
      });
      const fallbacks = [...items.values()].filter((i) => i.fallback).length;
      if (fallbacks)
        log('warn', `${fallbacks} cue(s) kept their source text because translation failed`);
      const translated: NewCue[] = source.cues.map((c) => {
        const item = items.get(c.idx);
        return {
          startMs: c.startMs,
          endMs: c.endMs,
          text: item?.text ?? c.text,
          speakerGender: item?.gender ?? 'u',
          sourceCueId: c.id,
        };
      });
      saveSubtitle(jobId, 'translated', initial.targetLang, translated);
      const removed = [...items.values()].filter((i) => i.removed).length;
      log(
        'info',
        removed
          ? `Translated ${translated.length - removed} cues; removed ${removed} line(s) nobody says in the audio (speech-to-text noise)`
          : `Translated ${translated.length} cues`,
      );
    } else {
      log('info', 'Translation already complete, skipping to write');
    }

    // 5. Write ---------------------------------------------------------------
    setStage('write');
    const finalCues = getSubtitle(jobId, 'translated')!.cues;
    const written = writeSubtitleFile({
      videoPath: media.path,
      cues: finalCues,
      targetLang: initial.targetLang,
      encoding,
      naming,
      overwrite, // the primary file's existence was checked at the start of the job
      protectedPaths: protectedPath ? [protectedPath] : [],
      ownPaths: [...(getJob(jobId)?.outputPaths ?? []), outPath],
    });
    for (const note of written.skipped) log('warn', note);
    if (written.fellBack)
      log(
        'warn',
        `Some characters do not exist in the legacy code page; wrote UTF-8 with BOM instead`,
      );
    log(
      'info',
      `Wrote ${written.paths.map((p) => path.basename(p)).join(' and ')} (${written.encoding}, ${finalCues.length} cues)`,
    );
    const done = updateJob(jobId, {
      status: 'done',
      stage: 'write',
      progress: 1,
      outputPath: written.path,
      outputPaths: written.paths,
      outputEncoding: written.encoding,
      finishedAt: Date.now(),
    });
    log(
      'info',
      `Done in ${Math.round((Date.now() - (done?.startedAt ?? Date.now())) / 1000)} s · $${(done?.costUsd ?? 0).toFixed(4)}`,
    );
    cleanup(tmpDir, settings.keepTempFiles);
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      log('warn', 'Cancelled');
      updateJob(jobId, { status: 'cancelled', finishedAt: Date.now() });
      cleanup(tmpDir, false);
      return;
    }
    const message = (err as Error).message || String(err);
    log('error', message);
    updateJob(jobId, { status: 'failed', error: message, finishedAt: Date.now() });
    cleanup(tmpDir, settings.keepTempFiles);
  }
}

function cleanup(dir: string, keep: boolean): void {
  if (keep) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
