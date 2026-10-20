import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, FolderOpen, PenLine, Plus, Square, Terminal } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { languageName } from '@shared/languages';
import type { Job } from '@shared/types';
import { EmptyState, PageHeader } from '@/components/empty';
import { LangChip, StageTimeline, StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Progress, Section } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { STAGE_DESCRIPTIONS, formatDuration, formatUsd, relativeTime } from '@/lib/format';

function useElapsed(job: Job | undefined): string {
  const q = useQuery({
    queryKey: ['tick'],
    queryFn: () => Date.now(),
    refetchInterval: 1000,
    enabled: !!job,
  });
  if (!job?.startedAt) return '';
  return formatDuration(((q.data ?? Date.now()) - job.startedAt) / 1000);
}

/** The letterboxed "screen": the active job's status rendered as a subtitle line. */
function Screen({ job, needsKey }: { job: Job | undefined; needsKey: boolean }) {
  const logs = useQuery({
    queryKey: ['logs', job?.id],
    queryFn: () => api.logs(job!.id),
    enabled: !!job,
  });
  const elapsed = useElapsed(job);
  const lastInfo = [...(logs.data?.logs ?? [])].reverse().find((l) => l.level !== 'debug');
  const target = job ? job.options.targetLangName || languageName(job.targetLang) : '';

  let line1: string;
  let line2: string | null = null;
  if (job) {
    line1 =
      job.stage === 'translate'
        ? `Translating into ${target}`
        : job.stage
          ? STAGE_DESCRIPTIONS[job.stage]
          : 'Starting';
    line2 = `${Math.round(job.progress * 100)} %${elapsed ? `  ·  ${elapsed}` : ''}`;
  } else if (needsKey) {
    line1 = 'Add an OpenRouter key or a local model endpoint to begin.';
  } else {
    line1 = 'Pick an episode or a whole season to begin.';
  }

  return (
    <div className="grid gap-4">
      <div className="screen relative overflow-hidden rounded-lg">
        <div className="h-5 bg-black/70" aria-hidden />
        <div className="relative flex aspect-[2.39/1] max-h-[340px] min-h-[220px] w-full flex-col justify-between px-5 py-4 sm:px-8">
          <div className="flex items-start justify-between gap-4 text-xs text-[#9aa3b5]">
            {job ? (
              <Link to={`/jobs/${job.id}`} className="grid min-w-0 gap-1 hover:text-[#e9eefc]">
                <span className="truncate text-sm font-medium text-[#e4e8f2]">{job.fileName}</span>
                <span className="flex items-center gap-1.5">
                  <LangChip
                    code={job.detectedLang ?? job.sourceLang}
                    kind="source"
                    className="bg-[#1f2a44] text-[#9dbaf8]"
                  />
                  <span aria-hidden>→</span>
                  <LangChip
                    code={job.targetLang}
                    kind="target"
                    className="bg-[#3a3320] text-[#f2c94c]"
                  />
                </span>
              </Link>
            ) : (
              <span />
            )}
            {lastInfo && job && (
              <span className="hidden max-w-[50%] truncate text-right font-mono sm:block">
                {lastInfo.message}
              </span>
            )}
          </div>
          <div className="grid justify-items-center gap-1 pb-2 text-center">
            <p
              className="subtitle-line max-w-[36ch] text-balance text-[clamp(1.15rem,2.6vw,1.9rem)] leading-snug"
              aria-live="polite"
            >
              {line1}
            </p>
            {line2 && (
              <p className="subtitle-line-source tabular text-[clamp(0.95rem,1.8vw,1.25rem)] font-semibold">
                {line2}
              </p>
            )}
          </div>
          <div className="flex justify-center">
            {!job && (
              <Button asChild variant="primary" size="lg">
                <Link to={needsKey ? '/settings' : '/new'}>
                  {needsKey ? (
                    'Open settings'
                  ) : (
                    <>
                      <Plus /> New translation
                    </>
                  )}
                </Link>
              </Button>
            )}
          </div>
        </div>
        <div className="h-5 bg-black/70" aria-hidden />
      </div>
      {job && <StageTimeline job={job} />}
    </div>
  );
}

function QueueRow({ job }: { job: Job }) {
  const cancel = useMutation({
    mutationFn: () => api.cancelJob(job.id),
    onSuccess: () => toast(`Cancelled ${job.fileName}`),
  });
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[1fr_200px_auto] sm:items-center sm:gap-6">
      <Link to={`/jobs/${job.id}`} className="grid min-w-0 gap-0.5 hover:text-accent">
        <span className="truncate font-medium">{job.fileName}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <LangChip code={job.detectedLang ?? job.sourceLang} kind="source" />→
          <LangChip code={job.targetLang} kind="target" />
          <span className="ml-1">
            {job.status === 'running' && job.stage
              ? STAGE_DESCRIPTIONS[job.stage]
              : 'Waiting for a free slot'}
          </span>
        </span>
      </Link>
      <div className="flex items-center gap-3">
        <Progress value={job.progress} tone={job.status === 'running' ? 'accent' : 'muted'} />
        <span className="tabular w-10 text-right text-xs text-muted">
          {Math.round(job.progress * 100)}%
        </span>
      </div>
      <Tooltip content="Cancel">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Cancel ${job.fileName}`}
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending}
        >
          <Square />
        </Button>
      </Tooltip>
    </li>
  );
}

function RecentRow({ job }: { job: Job }) {
  return (
    <tr className="border-t border-line">
      <td className="max-w-0 py-2.5 pr-4">
        <Link to={`/jobs/${job.id}`} className="block truncate font-medium hover:text-accent">
          {job.fileName}
        </Link>
        {job.status === 'failed' && <p className="truncate text-xs text-danger">{job.error}</p>}
      </td>
      <td className="py-2.5 pr-4">
        <StatusBadge status={job.status} />
      </td>
      <td className="hidden py-2.5 pr-4 sm:table-cell">
        <span className="flex items-center gap-1.5 text-xs">
          <LangChip code={job.detectedLang ?? job.sourceLang} kind="source" />→
          <LangChip code={job.targetLang} kind="target" />
        </span>
      </td>
      <td className="tabular hidden py-2.5 pr-4 text-right text-sm md:table-cell">
        {formatUsd(job.costUsd)}
      </td>
      <td className="hidden py-2.5 pr-4 text-right text-xs text-muted md:table-cell">
        {relativeTime(job.finishedAt ?? job.createdAt)}
      </td>
      <td className="py-2.5 text-right">
        <div className="flex justify-end gap-1">
          {job.status === 'done' && (
            <Tooltip content="Open in editor">
              <Button asChild variant="ghost" size="icon-sm">
                <Link to={`/jobs/${job.id}/editor`} aria-label="Open in editor">
                  <PenLine />
                </Link>
              </Button>
            </Tooltip>
          )}
          <Tooltip content="Log and details">
            <Button asChild variant="ghost" size="icon-sm">
              <Link to={`/jobs/${job.id}`} aria-label="Log and details">
                <Terminal />
              </Link>
            </Button>
          </Tooltip>
          {job.outputPath && (
            <Tooltip content="Show subtitle file">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Show subtitle file"
                onClick={() =>
                  api.reveal(job.outputPath!).catch((e: Error) => toast.error(e.message))
                }
              >
                <FolderOpen />
              </Button>
            </Tooltip>
          )}
        </div>
      </td>
    </tr>
  );
}

/** How many jobs run at the same time; saved to Settings and applied immediately. */
function JobsAtOnce() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const save = useMutation({
    mutationFn: (n: number) => api.saveSettings({ jobConcurrency: n }),
    onSuccess: (res) => {
      qc.setQueryData(['settings'], res);
      toast.success(`Up to ${res.settings.jobConcurrency} jobs at the same time`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const value = settings.data?.settings.jobConcurrency;
  if (!value) return null;
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Jobs at once
      <Select
        className="h-8 w-16"
        value={String(value)}
        onValueChange={(v) => save.mutate(Number(v))}
        options={[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: String(n) }))}
      />
    </label>
  );
}

export function DashboardPage() {
  const active = useQuery({
    queryKey: ['jobs', 'active'],
    queryFn: () => api.jobs({ status: 'running,queued' }),
  });
  const recent = useQuery({
    queryKey: ['jobs', 'recent'],
    queryFn: () => api.jobs({ status: 'done,failed,cancelled', limit: 10 }),
  });
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });

  const jobs = active.data?.jobs ?? [];
  const running = jobs
    .filter((j) => j.status === 'running')
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const queued = jobs
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt);
  const s = settings.data;
  const needsKey =
    !!s &&
    !s.meta.openrouterKeySource &&
    (s.settings.stt.provider === 'openrouter' || s.settings.translation.provider === 'openrouter');

  return (
    <div className="grid gap-10">
      <PageHeader
        title="Dashboard"
        description={
          stats.data ? (
            <span className="tabular">
              {stats.data.jobCounts.done} subtitle{stats.data.jobCounts.done === 1 ? '' : 's'} made
              · {formatDuration(stats.data.audioHours * 3600)} of audio transcribed ·{' '}
              {formatUsd(stats.data.monthUsd)} spent this month
            </span>
          ) : null
        }
        actions={
          <Button asChild variant="secondary">
            <Link to="/projects">
              <FolderOpen /> Shows & movies
            </Link>
          </Button>
        }
      />

      <Screen job={running[0]} needsKey={needsKey} />

      {(running.length > 0 || queued.length > 0) && (
        <Section
          title="Queue"
          description={`${running.length} running, ${queued.length} waiting. Each job is processed in parallel chunks.`}
          actions={<JobsAtOnce />}
        >
          <ul className="divide-y divide-line border-y border-line">
            {[...running, ...queued].map((j) => (
              <QueueRow key={j.id} job={j} />
            ))}
          </ul>
        </Section>
      )}

      <Section title="Recent" description="The latest finished, failed and cancelled jobs.">
        {recent.data && recent.data.jobs.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="No subtitles yet"
            description="Choose episodes or a movie on your disk. OSG writes the translated .srt next to each video, named so Plex, Jellyfin, Infuse and VLC pick it up automatically."
            action={
              <Button asChild variant="primary">
                <Link to="/new">
                  <Plus /> New translation
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2 font-medium">File</th>
                  <th className="w-28 pb-2 font-medium">Status</th>
                  <th className="hidden w-32 pb-2 font-medium sm:table-cell">Languages</th>
                  <th className="hidden w-20 pb-2 text-right font-medium md:table-cell">Cost</th>
                  <th className="hidden w-24 pb-2 text-right font-medium md:table-cell">When</th>
                  <th className="w-28 pb-2" />
                </tr>
              </thead>
              <tbody>
                {recent.data?.jobs.map((j) => (
                  <RecentRow key={j.id} job={j} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
