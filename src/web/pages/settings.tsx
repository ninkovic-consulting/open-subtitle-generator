import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AudioLines,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Languages,
  RotateCcw,
  Server,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  DEFAULT_SETTINGS,
  LOCAL_PRESETS,
  type ChatProviderSettings,
  type ReasoningEffort,
  type Settings,
  type SttProviderSettings,
  type TestProviderResult,
} from '@shared/types';
import { ErrorNote, PageHeader } from '@/components/empty';
import { LanguagePicker } from '@/components/language-picker';
import { ModelPicker } from '@/components/model-picker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Panel, Segmented, Spinner } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { SwitchRow } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { ENCODING_OPTIONS, NAMING_OPTIONS } from './new-translation';

function SecretInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const masked = value.includes('•');
  return (
    <div className="relative">
      <Input
        id={id}
        type={show && !masked ? 'text' : 'password'}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onFocus={(e) => masked && e.target.select()}
        onChange={(e) => onChange(e.target.value)}
        className="pr-10 font-mono text-sm"
      />
      {!masked && value && (
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Hide' : 'Show'}
          className="absolute right-2 top-2 cursor-pointer p-0.5 text-muted hover:text-text"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      )}
    </div>
  );
}

function TestResult({ result }: { result: TestProviderResult | undefined }) {
  if (!result) return null;
  return (
    <div
      className={`grid gap-1 rounded-md border px-3 py-2 text-sm ${result.ok ? 'border-ok/30 bg-ok-soft' : 'border-danger/30 bg-danger-soft'}`}
      role="status"
    >
      <p className={`flex items-center gap-2 font-medium ${result.ok ? 'text-ok' : 'text-danger'}`}>
        {result.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
        {result.message}
      </p>
      {result.details?.map((d) => (
        <p key={d} className="text-xs text-muted">
          {d}
        </p>
      ))}
    </div>
  );
}

function useTest(target: 'openrouter' | 'stt' | 'translation', draft: Settings) {
  return useMutation({
    mutationFn: () =>
      api.testProvider({
        target,
        openrouterApiKey: draft.openrouterApiKey,
        stt: draft.stt,
        translation: draft.translation,
      }),
  });
}

function ProviderCard({
  kind,
  draft,
  setDraft,
}: {
  kind: 'stt' | 'translation';
  draft: Settings;
  setDraft: (fn: (d: Settings) => void) => void;
}) {
  const cfg = draft[kind];
  const test = useTest(kind, draft);
  const isStt = kind === 'stt';
  const presets = isStt ? LOCAL_PRESETS.stt : LOCAL_PRESETS.translation;
  const defaults = DEFAULT_SETTINGS[kind];
  const set = <K extends keyof SttProviderSettings & keyof ChatProviderSettings>(
    k: K,
    v: Settings['stt'][K],
  ) =>
    setDraft((d) => {
      (d[kind] as Record<string, unknown>)[k] = v;
    });

  return (
    <Panel className="grid gap-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`grid size-9 place-items-center rounded-md ${isStt ? 'bg-source-soft text-source' : 'bg-accent-soft text-accent'}`}
          >
            {isStt ? <AudioLines className="size-5" /> : <Languages className="size-5" />}
          </div>
          <div className="grid gap-0.5">
            <h3 className="font-semibold">{isStt ? 'Speech-to-text' : 'Translation'}</h3>
            <p className="max-w-prose text-sm text-muted">
              {isStt
                ? 'Turns the audio into timed text. Skipped when the video already has a text subtitle.'
                : 'Builds the character sheet and translates the lines. Audio-capable models also hear who is speaking.'}
            </p>
          </div>
        </div>
        <Segmented
          ariaLabel={`${isStt ? 'Speech-to-text' : 'Translation'} provider`}
          value={cfg.provider}
          onChange={(v) =>
            setDraft((d) => {
              d[kind].provider = v;
              if (v === 'openrouter') d[kind].model = defaults.model;
              else if (d[kind].model === defaults.model || !d[kind].baseUrl) {
                const p = presets[0];
                d[kind].baseUrl ||= p.baseUrl;
                d[kind].model = p.model;
                if ('audioInput' in p) {
                  d.translation.audioInput = p.audioInput;
                  d.translation.structuredOutput = p.structuredOutput;
                }
              }
            })
          }
          options={[
            { value: 'openrouter', label: 'OpenRouter' },
            { value: 'custom', label: 'Custom endpoint' },
          ]}
        />
      </div>

      {cfg.provider === 'custom' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Preset"
            htmlFor={`${kind}-preset`}
            hint="Fills in the usual address and model name. Adjust to your setup."
          >
            <Select
              id={`${kind}-preset`}
              value={
                presets.find((p) => p.baseUrl === cfg.baseUrl && p.model === cfg.model)?.id ??
                '__none'
              }
              options={[
                { value: '__none', label: 'Choose a preset…' },
                ...presets.map((p) => ({ value: p.id, label: p.name, description: p.baseUrl })),
              ]}
              onValueChange={(id) => {
                const p = presets.find((x) => x.id === id);
                if (!p) return;
                setDraft((d) => {
                  d[kind].baseUrl = p.baseUrl;
                  d[kind].model = p.model;
                  if (!isStt && 'audioInput' in p) {
                    d.translation.audioInput = p.audioInput;
                    d.translation.structuredOutput = p.structuredOutput;
                  }
                });
              }}
            />
          </Field>
          <Field
            label="Base URL"
            htmlFor={`${kind}-url`}
            hint={
              isStt
                ? 'OSG calls {base URL}/audio/transcriptions'
                : 'OSG calls {base URL}/chat/completions'
            }
          >
            <Input
              id={`${kind}-url`}
              value={cfg.baseUrl}
              onChange={(e) => set('baseUrl', e.target.value)}
              placeholder="http://localhost:8000/v1"
              className="font-mono text-sm"
              spellCheck={false}
            />
          </Field>
          <Field
            label="API key"
            htmlFor={`${kind}-key`}
            hint="Leave empty for local servers without authentication."
          >
            <SecretInput
              id={`${kind}-key`}
              value={cfg.apiKey}
              onChange={(v) => set('apiKey', v)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Model" htmlFor={`${kind}-model`}>
            <ModelPicker
              id={`${kind}-model`}
              kind={isStt ? 'stt' : 'chat'}
              provider="custom"
              baseUrl={cfg.baseUrl}
              apiKey={cfg.apiKey}
              value={cfg.model}
              onChange={(v) => set('model', v)}
            />
          </Field>
        </div>
      )}

      {cfg.provider === 'openrouter' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Model" htmlFor={`${kind}-model`}>
            <ModelPicker
              id={`${kind}-model`}
              kind={isStt ? 'stt' : 'chat'}
              provider="openrouter"
              value={cfg.model}
              onChange={(v) => set('model', v)}
            />
          </Field>
          {isStt && (
            <Field
              label="Fallback model"
              htmlFor="stt-fallback"
              hint="Tried when the main model fails. Leave empty to disable."
            >
              <ModelPicker
                id="stt-fallback"
                kind="stt"
                provider="openrouter"
                value={draft.stt.fallbackModel}
                onChange={(v) => setDraft((d) => void (d.stt.fallbackModel = v))}
              />
            </Field>
          )}
        </div>
      )}

      {kind === 'translation' && cfg.provider === 'custom' && (
        <div className="divide-y divide-line rounded-md border border-line px-4">
          <SwitchRow
            id="tr-audio"
            title="Model accepts audio input"
            description="Turn on only for audio models (e.g. Qwen2.5-Omni, Gemma 3n via vLLM). Off: speaker gender is inferred from text."
            checked={draft.translation.audioInput}
            onCheckedChange={(v) => setDraft((d) => void (d.translation.audioInput = v))}
          />
          <SwitchRow
            id="tr-json"
            title="Server supports JSON schema output"
            description="Most servers do (Ollama, LM Studio, vLLM). If not, OSG asks for plain JSON and repairs it."
            checked={draft.translation.structuredOutput}
            onCheckedChange={(v) => setDraft((d) => void (d.translation.structuredOutput = v))}
          />
        </div>
      )}

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            {test.isPending ? <Spinner /> : <CheckCircle2 />} Test{' '}
            {isStt ? 'speech-to-text' : 'translation'}
          </Button>
          <span className="text-xs text-muted">
            {cfg.provider === 'openrouter'
              ? 'Sends a 2-second test clip or a one-line prompt (costs a fraction of a cent).'
              : 'Sends a tiny request to your server. Unsaved changes are tested too.'}
          </span>
        </div>
        <TestResult result={test.data} />
        <ErrorNote error={test.error} />
      </div>
    </Panel>
  );
}

function LocalModelsGuide() {
  return (
    <details className="group rounded-lg border border-line bg-panel">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 font-medium">
        <Server className="size-4 text-muted" />
        Running models on your own computer
        <span className="ml-auto text-xs text-muted group-open:hidden">Show guide</span>
      </summary>
      <div className="grid gap-5 border-t border-line px-5 py-5 text-sm leading-relaxed">
        <p className="max-w-prose text-muted">
          OSG talks to any server that speaks the OpenAI API, so you can replace one or both cloud
          steps with local models. Choose <em>Custom endpoint</em> above and point it at your
          server. Local requests cost nothing, and audio never leaves your machine.
        </p>
        <div className="grid gap-2">
          <h4 className="font-semibold text-source">1. Speech-to-text: a Whisper server</h4>
          <p className="max-w-prose">
            You need a server with an{' '}
            <code className="font-mono text-xs">/v1/audio/transcriptions</code> endpoint that runs
            Whisper and returns <code className="font-mono text-xs">verbose_json</code> with
            timestamps. Word timestamps give the best timing; segment timestamps also work.
          </p>
          <ul className="grid max-w-prose list-disc gap-1 pl-5 text-muted">
            <li>
              <strong className="text-text">Speaches</strong> (formerly faster-whisper-server): runs
              faster-whisper large-v3 on CPU or GPU, supports word timestamps. Base URL{' '}
              <code className="font-mono text-xs">http://localhost:8000/v1</code>, model{' '}
              <code className="font-mono text-xs">Systran/faster-whisper-large-v3</code>.
            </li>
            <li>
              <strong className="text-text">whisper.cpp server</strong>: fast on Apple Silicon.
              Start it with{' '}
              <code className="font-mono text-xs">--inference-path /v1/audio/transcriptions</code>{' '}
              and use base URL <code className="font-mono text-xs">http://localhost:8080/v1</code>.
            </li>
            <li>
              <strong className="text-text">LocalAI</strong> also serves Whisper models behind the
              same API.
            </li>
          </ul>
          <p className="max-w-prose text-muted">
            Use large-v3 (or large-v3-turbo) for good results in languages other than English; small
            models miss words and hallucinate on silence.
          </p>
        </div>
        <div className="grid gap-2">
          <h4 className="font-semibold text-accent">2. Translation: a chat model</h4>
          <p className="max-w-prose">
            Any server with <code className="font-mono text-xs">/v1/chat/completions</code>:{' '}
            <strong>Ollama</strong> (
            <code className="font-mono text-xs">http://localhost:11434/v1</code>),{' '}
            <strong>LM Studio</strong>, <strong>vLLM</strong> or <strong>llama.cpp</strong>. Pick a
            model that writes your subtitle language well; 12B+ models (Gemma 3 12B/27B, Qwen 2.5
            14B+) are a sensible minimum for Croatian and other Slavic languages.
          </p>
          <p className="max-w-prose">
            <strong>Hearing who speaks</strong> needs an audio-understanding model that accepts{' '}
            <code className="font-mono text-xs">input_audio</code>, for example Qwen2.5-Omni or
            Gemma 3n served with vLLM. Turn on <em>Model accepts audio input</em> for those. With
            text-only models, leave it off: OSG then infers speaker gender from names and context.
          </p>
        </div>
        <p className="max-w-prose text-muted">
          Mix and match freely, e.g. local Whisper for speech-to-text and Gemini on OpenRouter for
          translation. “Reset to defaults” brings back OpenRouter with Whisper large-v3 and Gemini
          3.1 Flash Lite.
        </p>
      </div>
    </details>
  );
}

const NUM = (v: string, fallback: number) =>
  Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback;

export function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [draft, setDraftState] = useState<Settings | null>(null);
  const [confirmReset, setConfirmReset] = useState<null | 'providers' | 'all'>(null);
  useEffect(() => {
    if (q.data) setDraftState(structuredClone(q.data.settings));
  }, [q.data]);
  const dirty = useMemo(
    () => !!draft && !!q.data && JSON.stringify(draft) !== JSON.stringify(q.data.settings),
    [draft, q.data],
  );
  const keyTest = useTest('openrouter', draft ?? DEFAULT_SETTINGS);

  const save = useMutation({
    mutationFn: (s: Settings) => api.saveSettings(s),
    onSuccess: (res) => {
      qc.setQueryData(['settings'], res);
      void qc.invalidateQueries({ queryKey: ['models'] });
      toast.success('Settings saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reset = useMutation({
    mutationFn: (scope: 'providers' | 'all') => api.resetSettings(scope),
    onSuccess: (res, scope) => {
      qc.setQueryData(['settings'], res);
      void qc.invalidateQueries({ queryKey: ['models'] });
      toast.success(
        scope === 'providers' ? 'AI providers reset to OpenRouter defaults' : 'All settings reset',
      );
      setConfirmReset(null);
    },
  });

  if (q.error) return <ErrorNote error={q.error} />;
  if (!draft || !q.data) return <Spinner />;
  const meta = q.data.meta;
  const setDraft = (fn: (d: Settings) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setDraftState(next);
  };
  const needsKey =
    draft.stt.provider === 'openrouter' || draft.translation.provider === 'openrouter';

  return (
    <div className="grid gap-12 pb-24">
      <PageHeader
        title="Settings"
        description="Stored locally in OSG’s database. API keys never leave this computer except to authenticate with the provider."
      />

      <section className="grid gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold">AI providers</h2>
            <p className="max-w-prose text-sm text-muted">
              Default: OpenRouter with{' '}
              <span className="font-mono text-xs">{DEFAULT_SETTINGS.stt.model}</span> for
              speech-to-text and{' '}
              <span className="font-mono text-xs">{DEFAULT_SETTINGS.translation.model}</span> for
              translation, about $0.10–0.15 per 45-minute episode.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setConfirmReset('providers')}>
            <RotateCcw /> Reset to defaults
          </Button>
        </div>

        <Panel className={`grid gap-4 p-5 ${needsKey ? '' : 'opacity-70'}`}>
          <div className="flex items-start gap-3">
            <div className="grid size-9 place-items-center rounded-md bg-panel-2 text-muted">
              <KeyRound className="size-5" />
            </div>
            <div className="grid gap-0.5">
              <h3 className="font-semibold">OpenRouter API key</h3>
              <p className="max-w-prose text-sm text-muted">
                One key for speech-to-text and translation.{' '}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-source hover:underline"
                >
                  Create a key <ExternalLink className="size-3" />
                </a>
                {!needsKey && ' Not needed while both steps use custom endpoints.'}
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
            <div className="grid gap-1.5">
              <SecretInput
                id="or-key"
                value={draft.openrouterApiKey}
                onChange={(v) => setDraft((d) => void (d.openrouterApiKey = v))}
                placeholder="sk-or-v1-…"
              />
              <p className="text-xs text-muted">
                {meta.openrouterKeySource === 'env'
                  ? 'Loaded from the .env file (OPENROUTER_API_KEY or OPEN_ROUTER_API). Paste a key here to override it.'
                  : meta.openrouterKeySource === 'settings'
                    ? 'Saved in OSG. Clear the field and save to fall back to .env.'
                    : 'No key yet. You can also set OPENROUTER_API_KEY in a .env file.'}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => keyTest.mutate()}
              disabled={keyTest.isPending}
            >
              {keyTest.isPending ? <Spinner /> : <CheckCircle2 />} Test key
            </Button>
          </div>
          <TestResult result={keyTest.data} />
        </Panel>

        <ProviderCard kind="stt" draft={draft} setDraft={setDraft} />
        <ProviderCard kind="translation" draft={draft} setDraft={setDraft} />
        <LocalModelsGuide />
      </section>

      <section className="grid gap-5">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Subtitles</h2>
          <p className="text-sm text-muted">
            Defaults for new translations. Each job can override them.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Spoken language" htmlFor="def-src">
            <LanguagePicker
              id="def-src"
              allowAuto
              allowCustom={false}
              value={draft.defaultSourceLang}
              onChange={(c) => setDraft((d) => void (d.defaultSourceLang = c))}
            />
          </Field>
          <Field label="Subtitle language" htmlFor="def-tgt">
            <LanguagePicker
              id="def-tgt"
              value={draft.defaultTargetLang}
              onChange={(c) => setDraft((d) => void (d.defaultTargetLang = c))}
            />
          </Field>
          <Field
            label="Encoding"
            htmlFor="def-enc"
            hint={ENCODING_OPTIONS.find((o) => o.value === draft.encoding)?.description}
          >
            <Select
              id="def-enc"
              value={draft.encoding}
              options={ENCODING_OPTIONS.map(({ value, label }) => ({ value, label }))}
              onValueChange={(v) => setDraft((d) => void (d.encoding = v))}
            />
          </Field>
          <Field
            label="File name"
            htmlFor="def-name"
            hint={NAMING_OPTIONS.find((o) => o.value === draft.naming)?.description}
          >
            <Select
              id="def-name"
              value={draft.naming}
              options={NAMING_OPTIONS.map(({ value, label }) => ({ value, label }))}
              onValueChange={(v) => setDraft((d) => void (d.naming = v))}
            />
          </Field>
        </div>
        <div className="divide-y divide-line rounded-lg border border-line bg-panel px-4">
          <SwitchRow
            id="def-existing"
            title="Use existing subtitles for timing"
            description="Translate an .srt next to the video or an embedded text track instead of transcribing."
            checked={draft.useExistingSubtitles}
            onCheckedChange={(v) => setDraft((d) => void (d.useExistingSubtitles = v))}
          />
          <SwitchRow
            id="def-voice"
            title="Listen to voices for gender"
            description="Send short audio clips with each translation batch so the model hears who speaks."
            checked={draft.useVoiceForGender}
            onCheckedChange={(v) => setDraft((d) => void (d.useVoiceForGender = v))}
          />
          <SwitchRow
            id="def-overwrite"
            title="Overwrite existing subtitles"
            description="Off: OSG stops before any paid request if the output file already exists."
            checked={draft.overwrite}
            onCheckedChange={(v) => setDraft((d) => void (d.overwrite = v))}
          />
        </div>
      </section>

      <section className="grid gap-5">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Performance</h2>
          <p className="text-sm text-muted">
            Higher parallelism finishes sooner but may hit provider rate limits.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field
            label="Jobs at the same time"
            htmlFor="perf-jobs"
            hint="Episodes processed in parallel (1–8). Also adjustable in the dashboard queue."
          >
            <Input
              id="perf-jobs"
              type="number"
              min={1}
              max={8}
              value={draft.jobConcurrency}
              onChange={(e) =>
                setDraft(
                  (d) =>
                    void (d.jobConcurrency = NUM(e.target.value, DEFAULT_SETTINGS.jobConcurrency)),
                )
              }
            />
          </Field>
          <Field label="Parallel speech-to-text chunks" htmlFor="perf-stt">
            <Input
              id="perf-stt"
              type="number"
              min={1}
              max={16}
              value={draft.sttConcurrency}
              onChange={(e) =>
                setDraft(
                  (d) =>
                    void (d.sttConcurrency = NUM(e.target.value, DEFAULT_SETTINGS.sttConcurrency)),
                )
              }
            />
          </Field>
          <Field label="Parallel translation batches" htmlFor="perf-tr">
            <Input
              id="perf-tr"
              type="number"
              min={1}
              max={16}
              value={draft.translateConcurrency}
              onChange={(e) =>
                setDraft(
                  (d) =>
                    void (d.translateConcurrency = NUM(
                      e.target.value,
                      DEFAULT_SETTINGS.translateConcurrency,
                    )),
                )
              }
            />
          </Field>
          <Field label="Lines per translation batch" htmlFor="perf-batch">
            <Input
              id="perf-batch"
              type="number"
              min={5}
              max={200}
              value={draft.batchSize}
              onChange={(e) => setDraft((d) => void (d.batchSize = NUM(e.target.value, 40)))}
            />
          </Field>
          <Field
            label="Audio chunk length (seconds)"
            htmlFor="perf-chunk"
            hint="Chunks are cut at silences near this length."
          >
            <Input
              id="perf-chunk"
              type="number"
              min={60}
              max={1800}
              step={30}
              value={draft.chunkSeconds}
              onChange={(e) => setDraft((d) => void (d.chunkSeconds = NUM(e.target.value, 600)))}
            />
          </Field>
          <Field label="Reasoning effort" htmlFor="perf-reason">
            <Select<ReasoningEffort>
              id="perf-reason"
              value={draft.reasoningEffort}
              options={[
                { value: 'none', label: 'None' },
                { value: 'minimal', label: 'Minimal (default)' },
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
              onValueChange={(v) => setDraft((d) => void (d.reasoningEffort = v))}
            />
          </Field>
          <Field
            label="Temperature"
            htmlFor="perf-temp"
            hint="0.3 keeps translations consistent but natural."
          >
            <Input
              id="perf-temp"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={draft.temperature}
              onChange={(e) => setDraft((d) => void (d.temperature = NUM(e.target.value, 0.3)))}
            />
          </Field>
        </div>
      </section>

      <section className="grid gap-5">
        <h2 className="text-lg font-semibold">Advanced</h2>
        <Field
          label="Data folder"
          hint="Database, logs and temporary audio. Set OSG_DATA_DIR to move it."
        >
          <p className="rounded-md border border-line bg-panel-2 px-3 py-2 font-mono text-xs break-all">
            {meta.dataDir}
          </p>
        </Field>
        <div className="divide-y divide-line rounded-lg border border-line bg-panel px-4">
          <SwitchRow
            id="adv-temp"
            title="Keep temporary files"
            description="Keep the extracted audio of failed jobs for debugging."
            checked={draft.keepTempFiles}
            onCheckedChange={(v) => setDraft((d) => void (d.keepTempFiles = v))}
          />
        </div>
        <div>
          <Button variant="danger" onClick={() => setConfirmReset('all')}>
            <RotateCcw /> Reset all settings
          </Button>
        </div>
      </section>

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 backdrop-blur md:left-[248px]">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-4 py-3 md:px-8">
            <p className="text-sm text-muted">You have unsaved changes.</p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setDraftState(structuredClone(q.data.settings))}
              >
                Discard
              </Button>
              <Button
                variant="primary"
                onClick={() => save.mutate(draft)}
                disabled={save.isPending}
              >
                {save.isPending && <Spinner />} Save settings
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={!!confirmReset} onOpenChange={(v) => !v && setConfirmReset(null)}>
        <DialogContent
          title={confirmReset === 'providers' ? 'Reset AI providers?' : 'Reset all settings?'}
          description={
            confirmReset === 'providers'
              ? 'Speech-to-text and translation go back to OpenRouter with Whisper large-v3 and Gemini 3.1 Flash Lite. Custom endpoint addresses and keys are cleared. Your OpenRouter key is kept.'
              : 'Every setting goes back to its default. Your OpenRouter key, projects and history are kept.'
          }
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmReset(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => confirmReset && reset.mutate(confirmReset)}
              disabled={reset.isPending}
            >
              {reset.isPending && <Spinner />} Reset to defaults
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
