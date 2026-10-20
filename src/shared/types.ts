import { z } from 'zod';

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export const JOB_STAGES = [
  'probe',
  'extract',
  'transcribe',
  'context',
  'translate',
  'write',
] as const;
export const TIMING_SOURCES = ['stt', 'sidecar_srt', 'embedded_srt'] as const;
export const ENCODINGS = ['utf8-bom', 'utf8', 'legacy'] as const;
export const NAMINGS = ['lang-suffix', 'plain'] as const;
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const;
export const PROVIDER_KINDS = ['openrouter', 'custom'] as const;
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export const GENDERS = ['m', 'f', 'u'] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobStage = (typeof JOB_STAGES)[number];
export type TimingSource = (typeof TIMING_SOURCES)[number];
export type OutputEncoding = (typeof ENCODINGS)[number];
export type Naming = (typeof NAMINGS)[number];
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type Gender = (typeof GENDERS)[number];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const sttProviderSchema = z.object({
  /** `openrouter` uses the OpenRouter key; `custom` calls any OpenAI-compatible `/audio/transcriptions`. */
  provider: z.enum(PROVIDER_KINDS),
  model: z.string().trim().min(1),
  /** Optional second model tried when the first one fails (OpenRouter only). */
  fallbackModel: z.string().trim(),
  baseUrl: z.string().trim(),
  apiKey: z.string(),
});

export const chatProviderSchema = z.object({
  /** `openrouter` uses the OpenRouter key; `custom` calls any OpenAI-compatible `/chat/completions`. */
  provider: z.enum(PROVIDER_KINDS),
  model: z.string().trim().min(1),
  baseUrl: z.string().trim(),
  apiKey: z.string(),
  /** Custom endpoints only: the model accepts `input_audio` content parts. */
  audioInput: z.boolean(),
  /** Custom endpoints only: the server supports `response_format: json_schema`. */
  structuredOutput: z.boolean(),
});

export const settingsSchema = z.object({
  openrouterApiKey: z.string(),
  stt: sttProviderSchema,
  translation: chatProviderSchema,
  defaultSourceLang: z.string().min(1),
  defaultTargetLang: z.string().min(1),
  encoding: z.enum(ENCODINGS),
  naming: z.enum(NAMINGS),
  overwrite: z.boolean(),
  useExistingSubtitles: z.boolean(),
  useVoiceForGender: z.boolean(),
  jobConcurrency: z.number().int().min(1).max(4),
  sttConcurrency: z.number().int().min(1).max(16),
  translateConcurrency: z.number().int().min(1).max(16),
  batchSize: z.number().int().min(5).max(200),
  reasoningEffort: z.enum(REASONING_EFFORTS),
  temperature: z.number().min(0).max(2),
  chunkSeconds: z.number().int().min(60).max(1800),
  keepTempFiles: z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SttProviderSettings = z.infer<typeof sttProviderSchema>;
export type ChatProviderSettings = z.infer<typeof chatProviderSchema>;

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_STT_MODEL = 'openai/whisper-large-v3';
export const DEFAULT_TRANSLATE_MODEL = 'google/gemini-3.1-flash-lite';

export const DEFAULT_SETTINGS: Settings = {
  openrouterApiKey: '',
  stt: {
    provider: 'openrouter',
    model: DEFAULT_STT_MODEL,
    fallbackModel: 'qwen/qwen3-asr-1.7b',
    baseUrl: '',
    apiKey: '',
  },
  translation: {
    provider: 'openrouter',
    model: DEFAULT_TRANSLATE_MODEL,
    baseUrl: '',
    apiKey: '',
    audioInput: true,
    structuredOutput: true,
  },
  defaultSourceLang: 'auto',
  defaultTargetLang: 'hr',
  encoding: 'utf8-bom',
  naming: 'lang-suffix',
  overwrite: false,
  useExistingSubtitles: true,
  useVoiceForGender: true,
  jobConcurrency: 1,
  sttConcurrency: 4,
  translateConcurrency: 6,
  batchSize: 40,
  reasoningEffort: 'minimal',
  temperature: 0.3,
  chunkSeconds: 600,
  keepTempFiles: false,
};

/** Presets shown in Settings to fill in a custom (local) endpoint quickly. */
export const LOCAL_PRESETS = {
  stt: [
    {
      id: 'speaches',
      name: 'Speaches / faster-whisper-server',
      baseUrl: 'http://localhost:8000/v1',
      model: 'Systran/faster-whisper-large-v3',
    },
    {
      id: 'whisper-cpp',
      name: 'whisper.cpp server',
      baseUrl: 'http://localhost:8080/v1',
      model: 'whisper-1',
    },
    {
      id: 'localai',
      name: 'LocalAI',
      baseUrl: 'http://localhost:8080/v1',
      model: 'whisper-1',
    },
    {
      id: 'groq',
      name: 'Groq (cloud, OpenAI-compatible)',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'whisper-large-v3',
    },
  ],
  translation: [
    {
      id: 'ollama',
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'gemma3:12b',
      audioInput: false,
      structuredOutput: true,
    },
    {
      id: 'lmstudio',
      name: 'LM Studio',
      baseUrl: 'http://localhost:1234/v1',
      model: 'qwen2.5-7b-instruct',
      audioInput: false,
      structuredOutput: true,
    },
    {
      id: 'vllm-omni',
      name: 'vLLM (audio model, e.g. Qwen2.5-Omni)',
      baseUrl: 'http://localhost:8000/v1',
      model: 'Qwen/Qwen2.5-Omni-7B',
      audioInput: true,
      structuredOutput: true,
    },
    {
      id: 'llamacpp',
      name: 'llama.cpp server',
      baseUrl: 'http://localhost:8080/v1',
      model: 'local',
      audioInput: false,
      structuredOutput: false,
    },
  ],
} as const;

export interface SettingsResponse {
  settings: Settings;
  meta: {
    openrouterKeySource: 'settings' | 'env' | null;
    dataDir: string;
    version: string;
    defaults: Settings;
  };
}

/** Partial update. Masked secrets (containing `•`) are ignored so the stored key is kept. */
export const settingsUpdateSchema = settingsSchema
  .extend({
    stt: sttProviderSchema.partial(),
    translation: chatProviderSchema.partial(),
  })
  .partial();
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export const testProviderSchema = z.object({
  target: z.enum(['openrouter', 'stt', 'translation']),
  /** Optional unsaved values from the form, so users can test before saving. */
  stt: sttProviderSchema.partial().optional(),
  translation: chatProviderSchema.partial().optional(),
  openrouterApiKey: z.string().optional(),
});
export type TestProviderBody = z.infer<typeof testProviderSchema>;

export interface TestProviderResult {
  ok: boolean;
  message: string;
  details?: string[];
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const jobOptionsSchema = z.object({
  /** Use a sidecar/embedded subtitle as timing source instead of transcribing. */
  useExistingSubtitles: z.boolean().optional(),
  useVoiceForGender: z.boolean().optional(),
  sttModel: z.string().optional(),
  translateModel: z.string().optional(),
  encoding: z.enum(ENCODINGS).optional(),
  naming: z.enum(NAMINGS).optional(),
  overwrite: z.boolean().optional(),
  /** Index among the file's audio streams (0-based). */
  audioTrack: z.number().int().min(0).optional(),
  /** Display name for custom target languages. */
  targetLangName: z.string().optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  batchSize: z.number().int().min(5).max(200).optional(),
  /** Re-translation: start from the source cues of this job instead of transcribing again. */
  reuseSourceFromJobId: z.number().int().optional(),
  /** Retry from a specific stage (keeps earlier results). */
  fromStage: z.enum(JOB_STAGES).optional(),
});
export type JobOptions = z.infer<typeof jobOptionsSchema>;

export const createJobsSchema = z
  .object({
    mediaFileIds: z.array(z.number().int()).optional(),
    paths: z.array(z.string().min(1)).optional(),
    projectId: z.number().int().optional(),
    projectName: z.string().trim().min(1).optional(),
    sourceLang: z.string().default('auto'),
    targetLang: z.string().min(1),
    options: jobOptionsSchema.default({}),
  })
  .refine((v) => (v.mediaFileIds?.length ?? 0) + (v.paths?.length ?? 0) > 0, {
    message: 'Select at least one video file',
  });
export type CreateJobsBody = z.infer<typeof createJobsSchema>;

export const estimateSchema = z.object({
  mediaFileIds: z.array(z.number().int()).optional(),
  paths: z.array(z.string().min(1)).optional(),
  options: jobOptionsSchema.default({}),
  targetLang: z.string().optional(),
});

export interface FileEstimate {
  path: string;
  fileName: string;
  durationSec: number | null;
  timingSource: TimingSource;
  timingDetail: string | null;
  sttUsd: number;
  translateUsd: number;
  totalUsd: number;
  existingOutput: string | null;
  error?: string;
}

export interface EstimateResponse {
  files: FileEstimate[];
  totalUsd: number;
  totalDurationSec: number;
  pricingKnown: boolean;
}

export interface Job {
  id: number;
  mediaFileId: number;
  projectId: number | null;
  fileName: string;
  filePath: string;
  status: JobStatus;
  stage: JobStage | null;
  progress: number;
  sourceLang: string;
  detectedLang: string | null;
  targetLang: string;
  timingSource: TimingSource | null;
  sttModel: string | null;
  translateModel: string | null;
  options: JobOptions;
  outputPath: string | null;
  outputEncoding: string | null;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  audioSeconds: number;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
}

export interface JobLog {
  id: number;
  jobId: number;
  ts: number;
  level: LogLevel;
  stage: string | null;
  message: string;
  data: unknown;
}

export interface ApiCall {
  id: number;
  jobId: number | null;
  kind: 'stt' | 'context' | 'translate' | 'test';
  model: string;
  requestMs: number;
  tokensIn: number;
  tokensOut: number;
  audioTokens: number;
  costUsd: number;
  status: 'ok' | 'error';
  error: string | null;
  ts: number;
}

export interface Cue {
  id: number;
  subtitleId: number;
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
  speakerGender: Gender;
  sourceCueId: number | null;
  edited: boolean;
}

export interface SubtitlePair {
  job: Job;
  source: { id: number; language: string; cues: Cue[] } | null;
  translated: { id: number; language: string; cues: Cue[] } | null;
}

export const cueUpdateSchema = z.object({
  text: z.string().optional(),
  startMs: z.number().int().min(0).optional(),
  endMs: z.number().int().min(0).optional(),
  speakerGender: z.enum(GENDERS).optional(),
});

export const exportSchema = z.object({
  encoding: z.enum(ENCODINGS).optional(),
  naming: z.enum(NAMINGS).optional(),
  overwrite: z.boolean().default(true),
});

export const retranslateSchema = z.object({
  targetLang: z.string().min(1).optional(),
  translateModel: z.string().optional(),
  /** Only re-translate these translated cue ids (in place). Empty = whole file as a new job. */
  cueIds: z.array(z.number().int()).optional(),
  options: jobOptionsSchema.optional(),
});

// ---------------------------------------------------------------------------
// Projects, files, glossary
// ---------------------------------------------------------------------------

export interface Project {
  id: number;
  name: string;
  rootPath: string;
  defaultSourceLang: string;
  defaultTargetLang: string;
  createdAt: number;
  updatedAt: number;
  fileCount: number;
  doneCount: number;
  costUsd: number;
}

export interface AudioTrack {
  index: number;
  streamIndex: number;
  language: string | null;
  codec: string;
  channels: number;
  title: string | null;
}

export interface SubtitleTrack {
  index: number;
  streamIndex: number;
  language: string | null;
  codec: string;
  textBased: boolean;
  title: string | null;
}

export interface MediaFile {
  id: number;
  projectId: number;
  path: string;
  fileName: string;
  sizeBytes: number;
  durationSec: number | null;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  sidecarSubtitles: string[];
  addedAt: number;
  latestJob: Job | null;
}

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1),
  rootPath: z.string().min(1),
  defaultSourceLang: z.string().default('auto'),
  defaultTargetLang: z.string().default('hr'),
});

export const projectUpdateSchema = projectCreateSchema.partial();

export const glossarySchema = z.object({
  characters: z
    .array(
      z.object({
        name: z.string(),
        gender: z.enum(GENDERS).default('u'),
        notes: z.string().default(''),
      }),
    )
    .default([]),
  formality: z
    .array(
      z.object({
        speaker: z.string(),
        addressee: z.string(),
        form: z.enum(['informal', 'formal']),
        notes: z.string().default(''),
      }),
    )
    .default([]),
  terms: z
    .array(
      z.object({
        source: z.string(),
        target: z.string(),
        notes: z.string().default(''),
      }),
    )
    .default([]),
  styleNotes: z.string().default(''),
});
export type Glossary = z.infer<typeof glossarySchema>;
export const EMPTY_GLOSSARY: Glossary = {
  characters: [],
  formality: [],
  terms: [],
  styleNotes: '',
};

// ---------------------------------------------------------------------------
// File browser
// ---------------------------------------------------------------------------

export interface FsEntry {
  name: string;
  path: string;
  type: 'dir' | 'video' | 'subtitle';
  sizeBytes?: number;
  modifiedAt?: number;
  /** Search results only: folder of the entry relative to the searched folder. */
  relativeDir?: string;
}

export interface FsSearchResponse {
  path: string;
  query: string;
  entries: FsEntry[];
  /** True when the search stopped early (result or folder limit). */
  truncated: boolean;
}

export interface DeleteSubtitleResponse {
  deletedFile: string | null;
  jobRemoved: boolean;
}

export interface FsListResponse {
  path: string;
  parent: string | null;
  entries: FsEntry[];
  videoCount: number;
}

export interface FsRoot {
  name: string;
  path: string;
  kind: 'home' | 'folder' | 'volume';
}

// ---------------------------------------------------------------------------
// Models, stats, events
// ---------------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  name: string;
  /** USD per second of audio for STT models; USD per token otherwise. */
  promptPrice: number | null;
  completionPrice: number | null;
  audioPrice: number | null;
  audioInput: boolean;
  structuredOutput: boolean;
  contextLength: number | null;
}

export interface StatsResponse {
  totalUsd: number;
  monthUsd: number;
  todayUsd: number;
  jobCounts: Record<JobStatus, number>;
  byDay: { day: string; costUsd: number; jobs: number }[];
  byProject: { projectId: number | null; name: string; costUsd: number; jobs: number }[];
  byModel: { model: string; kind: string; costUsd: number; calls: number }[];
  audioHours: number;
}

export type ServerEvent =
  | { type: 'job.update'; job: Job }
  | { type: 'job.log'; log: JobLog }
  | { type: 'job.deleted'; jobId: number }
  | { type: 'hello'; ts: number };
