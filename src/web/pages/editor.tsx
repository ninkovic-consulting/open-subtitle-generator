import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Languages, MonitorPlay, Search, Sparkles } from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { languageName } from '@shared/languages';
import type { Cue, Gender, OutputEncoding, Naming, SubtitlePair } from '@shared/types';
import { EmptyState, ErrorNote, PageHeader } from '@/components/empty';
import { LanguagePicker } from '@/components/language-picker';
import { ModelPicker } from '@/components/model-picker';
import { LangChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Segmented, Spinner } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip } from '@/components/ui/tooltip';
import { api, tokenUrl } from '@/lib/api';
import { cps, parseTimecode, timecode } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ENCODING_OPTIONS, NAMING_OPTIONS } from './new-translation';

const CPS_LIMIT = 20;
const GENDER_LABEL: Record<Gender, string> = { m: 'M', f: 'F', u: '?' };
const GENDER_TITLE: Record<Gender, string> = {
  m: 'Male speaker',
  f: 'Female speaker',
  u: 'Speaker gender unknown',
};
const NEXT_GENDER: Record<Gender, Gender> = { u: 'm', m: 'f', f: 'u' };

interface Row {
  source: Cue | undefined;
  target: Cue;
}

function TimeCell({ cue, onSave }: { cue: Cue; onSave: (startMs: number, endMs: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(timecode(cue.startMs));
  const [end, setEnd] = useState(timecode(cue.endMs));
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setStart(timecode(cue.startMs));
          setEnd(timecode(cue.endMs));
          setEditing(true);
        }}
        className="grid cursor-pointer gap-0.5 rounded px-1 py-0.5 text-left font-mono text-2xs leading-tight text-muted hover:bg-panel-2 hover:text-text"
        aria-label={`Edit timing of line ${cue.idx}`}
      >
        <span className="tabular">{timecode(cue.startMs)}</span>
        <span className="tabular text-faint">{timecode(cue.endMs)}</span>
      </button>
    );
  }
  const commit = () => {
    const s = parseTimecode(start);
    const e = parseTimecode(end);
    if (s === null || e === null || e <= s) {
      toast.error('Use HH:MM:SS,mmm and make the end later than the start');
      return;
    }
    onSave(s, e);
    setEditing(false);
  };
  return (
    <form
      className="grid gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
    >
      <Input
        autoFocus
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="h-7 px-1.5 font-mono text-2xs"
        aria-label="Start"
      />
      <Input
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className="h-7 px-1.5 font-mono text-2xs"
        aria-label="End"
        onBlur={commit}
      />
    </form>
  );
}

const CueRow = memo(function CueRow({
  row,
  selected,
  onSelect,
  onSeek,
  onSaveText,
  onSaveTiming,
  onGender,
  rtl,
}: {
  row: Row;
  selected: boolean;
  onSelect: (id: number, on: boolean) => void;
  onSeek: (ms: number) => void;
  onSaveText: (id: number, text: string) => void;
  onSaveTiming: (id: number, s: number, e: number) => void;
  onGender: (id: number, g: Gender) => void;
  rtl: boolean;
}) {
  const t = row.target;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(t.text);
  const rate = cps(t.text, t.startMs, t.endMs);
  const fast = rate > CPS_LIMIT;
  return (
    <div
      className={cn(
        'grid grid-cols-[28px_40px_92px_1fr] items-start gap-x-3 gap-y-1 border-t border-line px-3 py-2.5 md:grid-cols-[28px_40px_92px_1fr_1fr_64px]',
        selected && 'bg-accent-soft/40',
      )}
    >
      <Checkbox
        className="mt-1"
        aria-label={`Select line ${t.idx}`}
        checked={selected}
        onCheckedChange={(v) => onSelect(t.id, v === true)}
      />
      <button
        type="button"
        onClick={() => onSeek(t.startMs)}
        className="tabular mt-0.5 cursor-pointer text-left text-xs text-faint hover:text-text"
        title="Play from here"
      >
        {t.idx}
      </button>
      <TimeCell cue={t} onSave={(s, e) => onSaveTiming(t.id, s, e)} />
      <p className="col-span-1 whitespace-pre-line text-sm leading-snug text-source md:col-span-1">
        {row.source?.text ?? ''}
      </p>
      <div className="col-span-3 col-start-2 md:col-span-1 md:col-start-auto">
        {editing ? (
          <Textarea
            autoFocus
            dir={rtl ? 'rtl' : undefined}
            value={draft}
            rows={Math.max(2, draft.split('\n').length)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (draft !== t.text) onSaveText(t.id, draft);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft(t.text);
                setEditing(false);
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
                (e.target as HTMLTextAreaElement).blur();
            }}
            className="min-h-0 text-sm leading-snug"
          />
        ) : (
          <button
            type="button"
            dir={rtl ? 'rtl' : undefined}
            onClick={() => {
              setDraft(t.text);
              setEditing(true);
            }}
            className={cn(
              'block w-full cursor-text whitespace-pre-line rounded px-1 py-0.5 text-left text-sm leading-snug hover:bg-panel-2',
              t.edited && 'decoration-accent/60 underline decoration-dotted underline-offset-4',
            )}
          >
            {t.text ||
              (row.source ? (
                <span className="text-faint italic">
                  Removed: nobody says this in the audio. Click to add text.
                </span>
              ) : (
                <span className="text-faint">(empty)</span>
              ))}
          </button>
        )}
      </div>
      <div className="col-span-3 col-start-2 flex items-start gap-2 md:col-span-1 md:col-start-auto md:flex-col md:items-end">
        <Tooltip content={`${GENDER_TITLE[t.speakerGender]} · click to change`}>
          <button
            type="button"
            onClick={() => onGender(t.id, NEXT_GENDER[t.speakerGender])}
            className={cn(
              'grid h-5 min-w-5 cursor-pointer place-items-center rounded-sm px-1 text-2xs font-semibold',
              t.speakerGender === 'm' && 'bg-source-soft text-source',
              t.speakerGender === 'f' && 'bg-accent-soft text-accent',
              t.speakerGender === 'u' && 'bg-panel-2 text-faint',
            )}
            aria-label={GENDER_TITLE[t.speakerGender]}
          >
            {GENDER_LABEL[t.speakerGender]}
          </button>
        </Tooltip>
        <span
          className={cn('tabular text-2xs', fast ? 'font-semibold text-danger' : 'text-faint')}
          title="Characters per second"
        >
          {rate.toFixed(0)} cps
        </span>
      </div>
    </div>
  );
});

function ExportDialog({
  open,
  onOpenChange,
  pair,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pair: SubtitlePair;
}) {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [encoding, setEncoding] = useState<OutputEncoding | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const enc =
    encoding ?? pair.job.options.encoding ?? settings.data?.settings.encoding ?? 'utf8-bom';
  const nam = naming ?? pair.job.options.naming ?? settings.data?.settings.naming ?? 'lang-suffix';
  const exp = useMutation({
    mutationFn: () => api.exportJob(pair.job.id, { encoding: enc, naming: nam, overwrite: true }),
    onSuccess: (r) => {
      toast.success('Subtitle saved', { description: `${r.path} (${r.encoding})` });
      if (r.fellBack)
        toast.warning(
          'Some characters do not exist in the legacy code page, so UTF-8 with BOM was used.',
        );
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Save subtitle file"
        description="Writes the current lines, including your edits, next to the video."
      >
        <Field
          label="Encoding"
          htmlFor="exp-enc"
          hint={ENCODING_OPTIONS.find((o) => o.value === enc)?.description}
        >
          <Select
            id="exp-enc"
            value={enc}
            options={ENCODING_OPTIONS.map(({ value, label }) => ({ value, label }))}
            onValueChange={setEncoding}
          />
        </Field>
        <Field
          label="File name"
          htmlFor="exp-name"
          hint={NAMING_OPTIONS.find((o) => o.value === nam)?.description}
        >
          <Select
            id="exp-name"
            value={nam}
            options={NAMING_OPTIONS.map(({ value, label }) => ({ value, label }))}
            onValueChange={setNaming}
          />
        </Field>
        <ErrorNote error={exp.error} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => exp.mutate()} disabled={exp.isPending}>
            {exp.isPending ? <Spinner /> : <Download />} Save subtitle file
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RetranslateDialog({
  open,
  onOpenChange,
  pair,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pair: SubtitlePair;
}) {
  const navigate = useNavigate();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [lang, setLang] = useState(pair.job.targetLang);
  const [custom, setCustom] = useState<string | undefined>();
  const [model, setModel] = useState(pair.job.translateModel ?? '');
  const go = useMutation({
    mutationFn: () =>
      api.retranslate(pair.job.id, {
        targetLang: lang,
        translateModel: model || undefined,
        options: custom ? { targetLangName: custom } : undefined,
      }),
    onSuccess: ({ job }) => {
      toast.success('Re-translation queued');
      navigate(`/jobs/${job.id}`);
    },
  });
  const s = settings.data?.settings;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Translate again"
        description="Re-uses the existing transcript and timing, so no speech-to-text is paid again."
      >
        <Field label="Subtitle language" htmlFor="rt-lang">
          <LanguagePicker
            id="rt-lang"
            value={lang}
            onChange={(c, n) => {
              setLang(c);
              setCustom(n);
            }}
          />
        </Field>
        {s && (
          <Field label="Translation model" htmlFor="rt-model">
            <ModelPicker
              id="rt-model"
              kind="chat"
              provider={s.translation.provider}
              baseUrl={s.translation.baseUrl}
              value={model}
              onChange={setModel}
            />
          </Field>
        )}
        <ErrorNote error={go.error} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => go.mutate()} disabled={go.isPending}>
            {go.isPending ? <Spinner /> : <Languages />} Start re-translation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditorPage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['subtitles', id], queryFn: () => api.subtitles(id) });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'fast' | 'edited' | 'unknown' | 'removed'>('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState(false);
  const [vttVersion, setVttVersion] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [retranslating, setRetranslating] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  const pair = q.data;
  const rows: Row[] = useMemo(() => {
    if (!pair?.translated) return [];
    const src = new Map((pair.source?.cues ?? []).map((c) => [c.id, c]));
    return pair.translated.cues.map((t) => ({
      target: t,
      source: t.sourceCueId ? src.get(t.sourceCueId) : undefined,
    }));
  }, [pair]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'fast' && cps(r.target.text, r.target.startMs, r.target.endMs) <= CPS_LIMIT)
        return false;
      if (filter === 'edited' && !r.target.edited) return false;
      if (filter === 'unknown' && (r.target.speakerGender !== 'u' || !r.target.text)) return false;
      if (filter === 'removed' && r.target.text) return false;
      if (!needle) return true;
      return (
        r.target.text.toLowerCase().includes(needle) ||
        (r.source?.text.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [rows, search, filter]);
  const removedCount = useMemo(() => rows.filter((r) => !r.target.text && r.source).length, [rows]);
  const fastCount = useMemo(
    () =>
      rows.filter((r) => cps(r.target.text, r.target.startMs, r.target.endMs) > CPS_LIMIT).length,
    [rows],
  );

  const patchCache = (cue: Cue) => {
    qc.setQueryData<SubtitlePair>(['subtitles', id], (old) =>
      old?.translated
        ? {
            ...old,
            translated: {
              ...old.translated,
              cues: old.translated.cues.map((c) => (c.id === cue.id ? cue : c)),
            },
          }
        : old,
    );
    setVttVersion((v) => v + 1);
  };
  const update = useMutation({
    mutationFn: ({ cueId, patch }: { cueId: number; patch: Parameters<typeof api.updateCue>[1] }) =>
      api.updateCue(cueId, patch),
    onSuccess: ({ cue }) => patchCache(cue),
    onError: (e: Error) => toast.error(e.message),
  });
  const retranslateSel = useMutation({
    mutationFn: () => api.retranslate(id, { cueIds: [...selected] }),
    onSuccess: ({ cues }) => {
      for (const c of cues ?? []) patchCache(c);
      toast.success(`Re-translated ${cues?.length ?? 0} line(s)`);
      setSelected(new Set());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onSelect = (cueId: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(cueId);
      else next.delete(cueId);
      return next;
    });
  const onSeek = (ms: number) => {
    if (!preview) setPreview(true);
    requestAnimationFrame(() => {
      if (video.current) {
        video.current.currentTime = ms / 1000;
        void video.current.play().catch(() => undefined);
      }
    });
  };

  if (q.error) return <ErrorNote error={q.error} />;
  if (!pair) return <Spinner />;
  const job = pair.job;
  const rtl = ['ar', 'he', 'fa', 'ur'].includes(job.targetLang);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={<span className="break-all">{job.fileName}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link
              to={`/jobs/${job.id}`}
              className="inline-flex items-center gap-1 text-source hover:underline"
            >
              <ArrowLeft className="size-3.5" /> Job
            </Link>
            <LangChip code={job.detectedLang ?? job.sourceLang} kind="source" />→
            <LangChip code={job.targetLang} kind="target" />
            <span>{rows.length} lines</span>
            {fastCount > 0 && (
              <span className="text-danger">
                {fastCount} faster than {CPS_LIMIT} characters per second
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setRetranslating(true)}
              disabled={!pair.source}
            >
              <Languages /> Translate again
            </Button>
            <Button
              variant="primary"
              onClick={() => setExporting(true)}
              disabled={!pair.translated}
            >
              <Download /> Save .srt
            </Button>
          </>
        }
      />

      {!pair.translated ? (
        <EmptyState
          title="No translated lines yet"
          description="The editor opens once the job has finished translating."
        />
      ) : (
        <>
          {preview && (
            <div className="screen overflow-hidden rounded-lg">
              <video
                key={job.mediaFileId}
                ref={video}
                controls
                className="mx-auto max-h-[52vh] w-full bg-black"
                src={tokenUrl(`/api/media/${job.mediaFileId}/stream`)}
                crossOrigin="anonymous"
              >
                <track
                  key={vttVersion}
                  kind="subtitles"
                  srcLang={job.targetLang}
                  label={languageName(job.targetLang)}
                  src={tokenUrl(`/api/jobs/${job.id}/vtt`, { kind: 'translated', v: vttVersion })}
                  default
                />
              </video>
              <p className="px-4 py-2 text-xs text-[#a3a9b6]">
                Browsers play MP4 and WebM; some MKV files have no picture or sound here. The
                subtitle file itself is not affected.
              </p>
            </div>
          )}

          <div className="sticky top-14 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-bg/90 px-1 py-2 backdrop-blur">
            <div className="relative min-w-52 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search both languages"
                className="pl-8"
              />
            </div>
            <Segmented
              ariaLabel="Filter lines"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'fast', label: 'Too fast' },
                { value: 'unknown', label: 'Gender ?' },
                { value: 'edited', label: 'Edited' },
                ...(removedCount
                  ? [{ value: 'removed' as const, label: `Removed (${removedCount})` }]
                  : []),
              ]}
            />
            <label className="flex items-center gap-2 text-sm text-muted">
              <Switch checked={preview} onCheckedChange={setPreview} />
              <MonitorPlay className="size-4" /> Preview
            </label>
            <Button
              variant="secondary"
              size="sm"
              disabled={selected.size === 0 || retranslateSel.isPending}
              onClick={() => retranslateSel.mutate()}
            >
              {retranslateSel.isPending ? <Spinner /> : <Sparkles />} Re-translate{' '}
              {selected.size || ''} selected
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border border-line bg-panel">
            <div className="hidden grid-cols-[28px_40px_92px_1fr_1fr_64px] gap-x-3 bg-panel-2 px-3 py-2 text-xs text-muted md:grid">
              <Checkbox
                aria-label="Select all visible"
                checked={
                  visible.length > 0 && visible.every((r) => selected.has(r.target.id))
                    ? true
                    : visible.some((r) => selected.has(r.target.id))
                      ? 'indeterminate'
                      : false
                }
                onCheckedChange={(v) =>
                  setSelected(v === true ? new Set(visible.map((r) => r.target.id)) : new Set())
                }
              />
              <span>#</span>
              <span>Time</span>
              <span className="text-source">
                Original{pair.source ? ` (${languageName(pair.source.language)})` : ''}
              </span>
              <span className="text-accent">
                Translation ({job.options.targetLangName || languageName(job.targetLang)})
              </span>
              <span className="text-right">Speaker</span>
            </div>
            {visible.map((r) => (
              <CueRow
                key={r.target.id}
                row={r}
                rtl={rtl}
                selected={selected.has(r.target.id)}
                onSelect={onSelect}
                onSeek={onSeek}
                onSaveText={(cueId, text) => update.mutate({ cueId, patch: { text } })}
                onSaveTiming={(cueId, startMs, endMs) =>
                  update.mutate({ cueId, patch: { startMs, endMs } })
                }
                onGender={(cueId, speakerGender) =>
                  update.mutate({ cueId, patch: { speakerGender } })
                }
              />
            ))}
            {visible.length === 0 && (
              <p className="border-t border-line p-4 text-sm text-muted">No lines match.</p>
            )}
          </div>
          <p className="text-xs text-muted">
            Click a line to edit it; ⌘/Ctrl + Enter or clicking away saves. Click a line number to
            play from there. Edits are saved in OSG; use “Save .srt” to write them to disk.
          </p>
          <ExportDialog open={exporting} onOpenChange={setExporting} pair={pair} />
          <RetranslateDialog open={retranslating} onOpenChange={setRetranslating} pair={pair} />
        </>
      )}
    </div>
  );
}
