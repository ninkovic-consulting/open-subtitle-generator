import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Captions, Check, Mic, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { findLanguage, languageName } from '@shared/languages';
import type { FsEntry, JobOptions, OutputEncoding, Naming, ReasoningEffort } from '@shared/types';
import { ErrorNote, PageHeader } from '@/components/empty';
import { FileBrowser } from '@/components/file-browser';
import { LanguagePicker } from '@/components/language-picker';
import { ModelPicker } from '@/components/model-picker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/label';
import { Panel, Spinner } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { SwitchRow } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { TIMING_LABELS, formatDuration, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

const STEPS = ['Videos', 'Languages', 'Options', 'Review'] as const;

export const ENCODING_OPTIONS: { value: OutputEncoding; label: string; description: string }[] = [
  {
    value: 'utf8-bom',
    label: 'UTF-8 with BOM',
    description: 'Works for every language; the BOM helps TVs recognise UTF-8.',
  },
  { value: 'utf8', label: 'UTF-8 without BOM', description: 'For tools that dislike the BOM.' },
  {
    value: 'legacy',
    label: 'Legacy code page',
    description:
      'For old TVs (e.g. Windows-1250 for Croatian). Falls back to UTF-8 if a character does not fit.',
  },
];

export const NAMING_OPTIONS: { value: Naming; label: string; description: string }[] = [
  {
    value: 'lang-suffix',
    label: 'Episode.hr.srt',
    description: 'Language code in the name. Auto-loaded by Plex, Jellyfin, Infuse, VLC.',
  },
  {
    value: 'plain',
    label: 'Episode.srt',
    description:
      'Exactly the video’s name. What Samsung, LG and most TVs look for when playing from USB.',
  },
  {
    value: 'both',
    label: 'Both: Episode.hr.srt + Episode.srt',
    description:
      'Works on TVs (identical name) and in Plex, Jellyfin, Infuse, VLC (language code).',
  },
];

export function NewTranslationPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const s = settingsQ.data?.settings;

  const presetProject = params.get('project') ? Number(params.get('project')) : undefined;
  const presetMedia = useMemo(
    () => (params.get('media') ?? '').split(',').map(Number).filter(Boolean),
    [params],
  );
  const projectFiles = useQuery({
    queryKey: ['project-files', presetProject],
    queryFn: () => api.projectFiles(presetProject!),
    enabled: !!presetProject && presetMedia.length > 0,
  });
  const project = useQuery({
    queryKey: ['projects', presetProject],
    queryFn: () => api.project(presetProject!),
    enabled: !!presetProject,
  });

  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Map<string, FsEntry>>(new Map());
  const [mediaIds, setMediaIds] = useState<number[]>(presetMedia);
  const [sourceLang, setSourceLang] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState<string | null>(null);
  const [targetName, setTargetName] = useState<string | undefined>();
  const [opts, setOpts] = useState<JobOptions>({});
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  useEffect(() => setMediaIds(presetMedia), [presetMedia]);
  useEffect(() => {
    const p = project.data?.project;
    if (p) {
      setSourceLang((v) => v ?? p.defaultSourceLang);
      setTargetLang((v) => v ?? p.defaultTargetLang);
    }
  }, [project.data]);

  const src = sourceLang ?? s?.defaultSourceLang ?? 'auto';
  const tgt = targetLang ?? s?.defaultTargetLang ?? 'hr';
  const merged = {
    useExistingSubtitles: opts.useExistingSubtitles ?? s?.useExistingSubtitles ?? true,
    useVoiceForGender: opts.useVoiceForGender ?? s?.useVoiceForGender ?? true,
    translateModel: opts.translateModel ?? s?.translation.model ?? '',
    sttModel: opts.sttModel ?? s?.stt.model ?? '',
    encoding: opts.encoding ?? s?.encoding ?? 'utf8-bom',
    naming: opts.naming ?? s?.naming ?? 'lang-suffix',
    overwrite: opts.overwrite ?? s?.overwrite ?? false,
    reasoningEffort: opts.reasoningEffort ?? s?.reasoningEffort ?? 'minimal',
  };
  const set = <K extends keyof JobOptions>(k: K, v: JobOptions[K]) =>
    setOpts((o) => ({ ...o, [k]: v }));

  const usingPreset = mediaIds.length > 0 && picked.size === 0;
  const selectedCount = usingPreset ? mediaIds.length : picked.size;
  const presetNames = (projectFiles.data?.files ?? [])
    .filter((f) => mediaIds.includes(f.id))
    .map((f) => f.fileName);
  const jobOptions: JobOptions = {
    ...opts,
    ...merged,
    overwrite: merged.overwrite || confirmOverwrite,
    targetLangName: targetName,
  };
  const target = usingPreset ? { mediaFileIds: mediaIds } : { paths: [...picked.keys()] };

  const estimate = useQuery({
    queryKey: ['estimate', target, tgt, merged],
    queryFn: () => api.estimate({ ...target, options: jobOptions, targetLang: tgt }),
    enabled: step === 3 && selectedCount > 0,
  });
  const existing = estimate.data?.files.filter((f) => f.existingOutput) ?? [];
  const blocked = existing.length > 0 && !merged.overwrite && !confirmOverwrite;

  const start = useMutation({
    mutationFn: () =>
      api.createJobs({
        ...target,
        projectId: usingPreset ? presetProject : undefined,
        sourceLang: src,
        targetLang: tgt,
        options: jobOptions,
      }),
    onSuccess: ({ jobs }) => {
      toast.success(`Queued ${jobs.length} job${jobs.length === 1 ? '' : 's'}`);
      navigate(jobs.length === 1 ? `/jobs/${jobs[0]!.id}` : '/');
    },
  });

  const sttCustom = s?.stt.provider === 'custom';
  const chatCustom = s?.translation.provider === 'custom';
  const audioCapable = !chatCustom || !!s?.translation.audioInput;

  const canNext = step === 0 ? selectedCount > 0 : step === 1 ? !!tgt : true;

  return (
    <div className="grid gap-8">
      <PageHeader
        title="New translation"
        description="Subtitles are written next to each video. Nothing is uploaded except audio and text sent to the models you configured."
      />
      <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
        <ol className="flex gap-2 overflow-x-auto lg:grid lg:content-start lg:gap-1">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                disabled={i > step && !canNext}
                onClick={() => (i <= step || canNext) && setStep(Math.min(i, step + 1))}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm disabled:cursor-default',
                  i === step
                    ? 'bg-panel font-medium ring-1 ring-line'
                    : 'text-muted hover:text-text',
                )}
              >
                <span
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full border text-xs tabular',
                    i < step
                      ? 'border-accent-fill bg-accent-fill text-accent-ink'
                      : i === step
                        ? 'border-text'
                        : 'border-line-strong',
                  )}
                >
                  {i < step ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        <div className="grid min-w-0 content-start gap-6">
          {step === 0 && (
            <div className="grid gap-4">
              {usingPreset ? (
                <Panel className="grid gap-3 p-4">
                  <p className="font-medium">
                    {mediaIds.length} episode{mediaIds.length === 1 ? '' : 's'} from{' '}
                    {project.data?.project.name ?? 'this folder'}
                  </p>
                  <ul className="grid max-h-48 gap-0.5 overflow-y-auto text-sm text-muted">
                    {presetNames.map((n) => (
                      <li key={n} className="truncate">
                        {n}
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant="ghost"
                    className="justify-self-start"
                    onClick={() => setMediaIds([])}
                  >
                    Choose other files
                  </Button>
                </Panel>
              ) : (
                <>
                  <FileBrowser mode="files" selected={picked} onSelectedChange={setPicked} />
                  <p className="text-sm text-muted" aria-live="polite">
                    {picked.size
                      ? `${picked.size} video${picked.size === 1 ? '' : 's'} selected`
                      : 'Select one or more videos, or select all in a season folder.'}
                  </p>
                </>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="grid max-w-2xl gap-6 sm:grid-cols-2">
              <Field
                label="Spoken language"
                htmlFor="src-lang"
                hint="Auto-detect works well; choosing it helps with short or noisy episodes."
              >
                <LanguagePicker
                  id="src-lang"
                  allowAuto
                  allowCustom={false}
                  value={src}
                  onChange={(c) => setSourceLang(c)}
                />
              </Field>
              <Field
                label="Subtitle language"
                htmlFor="tgt-lang"
                hint="Type any language name if it is not in the list."
              >
                <LanguagePicker
                  id="tgt-lang"
                  value={tgt}
                  onChange={(c, custom) => {
                    setTargetLang(c);
                    setTargetName(custom);
                  }}
                />
              </Field>
              <p className="text-sm text-muted sm:col-span-2">
                Output file:{' '}
                <span className="font-mono text-text">
                  Episode.{findLanguage(tgt)?.iso ?? tgt.toLowerCase().slice(0, 8)}.srt
                </span>
              </p>
            </div>
          )}

          {step === 2 && s && (
            <div className="grid max-w-3xl gap-8">
              <div className="divide-y divide-line rounded-lg border border-line bg-panel px-4">
                <SwitchRow
                  id="opt-existing"
                  title="Use existing subtitles for timing"
                  description="If an .srt next to the video or an embedded text subtitle exists, translate it instead of transcribing. Cheaper and perfectly timed."
                  checked={merged.useExistingSubtitles}
                  onCheckedChange={(v) => set('useExistingSubtitles', v)}
                />
                <SwitchRow
                  id="opt-voice"
                  title="Listen to voices for gender"
                  description={
                    audioCapable
                      ? 'Sends short audio clips with each batch so the model hears who speaks, for correct forms like “bio sam / bila sam”.'
                      : 'Your custom translation endpoint is set up without audio input, so gender is inferred from text.'
                  }
                  checked={merged.useVoiceForGender && audioCapable}
                  disabled={!audioCapable}
                  onCheckedChange={(v) => set('useVoiceForGender', v)}
                />
                <SwitchRow
                  id="opt-overwrite"
                  title="Overwrite existing subtitles"
                  description="Replace an .srt with the same name. The subtitle used as timing source is never overwritten."
                  checked={merged.overwrite}
                  onCheckedChange={(v) => set('overwrite', v)}
                />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Translation model" htmlFor="opt-tmodel">
                  <ModelPicker
                    id="opt-tmodel"
                    kind="chat"
                    provider={s.translation.provider}
                    baseUrl={s.translation.baseUrl}
                    value={merged.translateModel}
                    onChange={(v) => set('translateModel', v)}
                  />
                </Field>
                <Field label="Speech-to-text model" htmlFor="opt-smodel">
                  <ModelPicker
                    id="opt-smodel"
                    kind="stt"
                    provider={s.stt.provider}
                    baseUrl={s.stt.baseUrl}
                    value={merged.sttModel}
                    onChange={(v) => set('sttModel', v)}
                  />
                </Field>
                <Field
                  label="Encoding"
                  htmlFor="opt-enc"
                  hint={ENCODING_OPTIONS.find((o) => o.value === merged.encoding)?.description}
                >
                  <Select
                    id="opt-enc"
                    value={merged.encoding}
                    options={ENCODING_OPTIONS.map(({ value, label }) => ({ value, label }))}
                    onValueChange={(v) => set('encoding', v)}
                  />
                </Field>
                <Field
                  label="File name"
                  htmlFor="opt-naming"
                  hint={NAMING_OPTIONS.find((o) => o.value === merged.naming)?.description}
                >
                  <Select
                    id="opt-naming"
                    value={merged.naming}
                    options={NAMING_OPTIONS.map(({ value, label }) => ({ value, label }))}
                    onValueChange={(v) => set('naming', v)}
                  />
                </Field>
                <Field
                  label="Reasoning effort"
                  htmlFor="opt-reason"
                  hint="Higher effort can help hard dialogue but costs more and is slower."
                >
                  <Select<ReasoningEffort>
                    id="opt-reason"
                    value={merged.reasoningEffort}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'minimal', label: 'Minimal (default)' },
                      { value: 'low', label: 'Low' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'high', label: 'High' },
                    ]}
                    onValueChange={(v) => set('reasoningEffort', v)}
                  />
                </Field>
              </div>
              {(sttCustom || chatCustom) && (
                <p className="text-sm text-muted">
                  Using a custom endpoint for{' '}
                  {[sttCustom && 'speech-to-text', chatCustom && 'translation']
                    .filter(Boolean)
                    .join(' and ')}
                  . Local models cost nothing per request.
                </p>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-5">
              {estimate.isLoading && (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Spinner /> Reading files and estimating cost…
                </p>
              )}
              <ErrorNote error={estimate.error} />
              {estimate.data && (
                <>
                  <div className="screen grid gap-1 rounded-lg px-6 py-5 text-center">
                    <p className="subtitle-line text-2xl tabular">
                      ≈ {formatUsd(estimate.data.totalUsd)}
                    </p>
                    <p className="subtitle-line-source text-sm">
                      {estimate.data.files.length} file{estimate.data.files.length === 1 ? '' : 's'}{' '}
                      · {formatDuration(estimate.data.totalDurationSec)} · {languageName(src)} →{' '}
                      {targetName ?? languageName(tgt)}
                    </p>
                    {!estimate.data.pricingKnown && (
                      <p className="text-xs text-[#a3a9b6]">
                        Price is unknown for one of the selected models.
                      </p>
                    )}
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="w-full min-w-[560px] table-fixed text-sm">
                      <thead className="bg-panel-2 text-left text-xs text-muted">
                        <tr>
                          <th className="px-3 py-2 font-medium">File</th>
                          <th className="w-20 px-3 py-2 text-right font-medium">Length</th>
                          <th className="w-48 px-3 py-2 font-medium">Timing from</th>
                          <th className="w-24 px-3 py-2 text-right font-medium">Estimate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estimate.data.files.map((f) => (
                          <tr key={f.path} className="border-t border-line">
                            <td className="max-w-0 px-3 py-2">
                              <span className="block truncate">{f.fileName}</span>
                              {f.error && <span className="text-xs text-danger">{f.error}</span>}
                              {f.existingOutput && (
                                <span className="block text-xs text-warn">
                                  {f.existingOutput} already exists
                                </span>
                              )}
                            </td>
                            <td className="tabular px-3 py-2 text-right text-muted">
                              {formatDuration(f.durationSec)}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className="flex items-center gap-1.5 text-xs"
                                title={f.timingDetail ?? undefined}
                              >
                                {f.timingSource === 'stt' ? (
                                  <Mic className="size-3.5 text-source" />
                                ) : (
                                  <Captions className="size-3.5 text-ok" />
                                )}
                                <span className="truncate">
                                  {f.timingDetail ?? TIMING_LABELS[f.timingSource]}
                                </span>
                              </span>
                            </td>
                            <td className="tabular px-3 py-2 text-right">
                              {formatUsd(f.totalUsd)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {existing.length > 0 && !merged.overwrite && (
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm">
                      <Checkbox
                        checked={confirmOverwrite}
                        onCheckedChange={(v) => setConfirmOverwrite(v === true)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="flex items-center gap-1.5 font-medium text-warn">
                          <AlertTriangle className="size-4" /> {existing.length} subtitle file
                          {existing.length === 1 ? '' : 's'} already exist
                          {existing.length === 1 ? 's' : ''}
                        </span>
                        Replace them. Otherwise these jobs stop before any paid request.
                      </span>
                    </label>
                  )}
                </>
              )}
              <ErrorNote error={start.error} />
            </div>
          )}

          <div className="flex items-center justify-between border-t border-line pt-5">
            <Button
              variant="ghost"
              onClick={() => setStep((v) => Math.max(0, v - 1))}
              disabled={step === 0}
            >
              <ArrowLeft /> Back
            </Button>
            {step < 3 ? (
              <Button variant="primary" onClick={() => setStep((v) => v + 1)} disabled={!canNext}>
                Continue
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                onClick={() => start.mutate()}
                disabled={
                  start.isPending ||
                  !estimate.data ||
                  (blocked && existing.length === estimate.data.files.length)
                }
              >
                {start.isPending ? <Spinner /> : <Play />} Start{' '}
                {selectedCount > 1 ? `${selectedCount} jobs` : 'translation'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
