import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, FolderOpen, PenLine, RotateCcw, Square, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { languageName } from '@shared/languages';
import { JOB_STAGES, type JobStage } from '@shared/types';
import { ErrorNote, PageHeader } from '@/components/empty';
import { LogViewer } from '@/components/log-viewer';
import { LangChip, StageTimeline, StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress, Spinner } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import {
  STAGE_DESCRIPTIONS,
  STAGE_LABELS,
  TIMING_LABELS,
  clockTime,
  formatDuration,
  formatUsd,
  relativeTime,
} from '@/lib/format';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-4 border-t border-line py-2.5 text-sm first:border-t-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? '—'}</dd>
    </div>
  );
}

function CallsTable({ jobId }: { jobId: number }) {
  const calls = useQuery({
    queryKey: ['calls', jobId],
    queryFn: () => api.calls(jobId),
    refetchInterval: 15_000,
  });
  const rows = calls.data?.calls ?? [];
  if (!rows.length) return <p className="text-sm text-muted">No API calls yet.</p>;
  const total = rows.reduce((s, c) => s + c.costUsd, 0);
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-panel-2 text-left text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Kind</th>
            <th className="px-3 py-2 font-medium">Model</th>
            <th className="px-3 py-2 text-right font-medium">Duration</th>
            <th className="px-3 py-2 text-right font-medium">Tokens in / out</th>
            <th className="px-3 py-2 text-right font-medium">Audio tokens</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-line">
              <td className="tabular px-3 py-2 text-muted">{clockTime(c.ts)}</td>
              <td className="px-3 py-2">
                {c.kind}
                {c.status === 'error' && (
                  <span className="ml-2 text-xs text-danger" title={c.error ?? ''}>
                    failed
                  </span>
                )}
              </td>
              <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs">{c.model}</td>
              <td className="tabular px-3 py-2 text-right">{(c.requestMs / 1000).toFixed(1)} s</td>
              <td className="tabular px-3 py-2 text-right">
                {c.tokensIn.toLocaleString()} / {c.tokensOut.toLocaleString()}
              </td>
              <td className="tabular px-3 py-2 text-right">
                {c.audioTokens ? c.audioTokens.toLocaleString() : '—'}
              </td>
              <td className="tabular px-3 py-2 text-right">{formatUsd(c.costUsd, 5)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line-strong font-medium">
            <td className="px-3 py-2" colSpan={6}>
              {rows.length} call{rows.length === 1 ? '' : 's'}
            </td>
            <td className="tabular px-3 py-2 text-right">{formatUsd(total, 4)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function JobPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['job', id], queryFn: () => api.job(id) });
  const cancel = useMutation({ mutationFn: () => api.cancelJob(id) });
  const retry = useMutation({
    mutationFn: (stage?: JobStage) => api.retryJob(id, stage),
    onSuccess: () => toast.success('Job queued again'),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.removeJob(id),
    onSuccess: () => navigate('/'),
  });
  const job = q.data?.job;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!job) return <Spinner />;
  const active = job.status === 'running' || job.status === 'queued';

  return (
    <div className="grid gap-8">
      <PageHeader
        title={<span className="break-all">{job.fileName}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={job.status} />
            <LangChip code={job.detectedLang ?? job.sourceLang} kind="source" />→
            <LangChip code={job.targetLang} kind="target" />
            <span>{job.options.targetLangName || languageName(job.targetLang)}</span>
            <span className="text-faint">·</span>
            <span className="tabular">{formatUsd(job.costUsd)}</span>
            {job.projectId && (
              <>
                <span className="text-faint">·</span>
                <Link to={`/projects/${job.projectId}`} className="text-source hover:underline">
                  Open folder
                </Link>
              </>
            )}
          </span>
        }
        actions={
          <>
            {job.status === 'done' && (
              <Button asChild variant="primary">
                <Link to={`/jobs/${job.id}/editor`}>
                  <PenLine /> Review & edit
                </Link>
              </Button>
            )}
            {active && (
              <Button variant="danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                <Square /> Cancel
              </Button>
            )}
            {!active && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary">
                    <RotateCcw /> Retry <ChevronDown className="text-muted" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => retry.mutate(undefined)}>
                    Retry, keeping finished stages
                  </DropdownMenuItem>
                  <DropdownMenuLabel>Retry from stage</DropdownMenuLabel>
                  {JOB_STAGES.filter((s) => s !== 'extract').map((s) => (
                    <DropdownMenuItem key={s} onSelect={() => retry.mutate(s)}>
                      {STAGE_LABELS[s]}
                      <span className="ml-auto text-xs text-muted">
                        {STAGE_DESCRIPTIONS[s].toLowerCase()}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {job.outputPath && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Show subtitle file"
                onClick={() =>
                  api.reveal(job.outputPath!).catch((e: Error) => toast.error(e.message))
                }
              >
                <FolderOpen />
              </Button>
            )}
            {!active && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete job from history"
                onClick={() => remove.mutate()}
              >
                <Trash2 />
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3">
        <StageTimeline job={job} />
        {active && (
          <div className="flex items-center gap-3">
            <Progress value={job.progress} />
            <span className="tabular w-12 text-right text-sm text-muted">
              {Math.round(job.progress * 100)}%
            </span>
          </div>
        )}
      </div>

      {job.status === 'failed' && job.error && (
        <div className="grid gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4">
          <p className="font-medium text-danger">
            The job stopped{job.stage ? ` at “${STAGE_LABELS[job.stage]}”` : ''}
          </p>
          <p className="text-sm break-words">{job.error}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => retry.mutate(undefined)}>
              <RotateCcw /> Retry
            </Button>
            {/key|401|credit|402/i.test(job.error) && (
              <Button asChild variant="ghost" size="sm">
                <Link to="/settings">Check settings</Link>
              </Button>
            )}
          </div>
        </div>
      )}

      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="log">Log</TabsTrigger>
          <TabsTrigger value="calls">API calls</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="log">
          <LogViewer jobId={job.id} live={active} />
        </TabsContent>
        <TabsContent value="calls">
          <CallsTable jobId={job.id} />
        </TabsContent>
        <TabsContent value="details">
          <dl className="max-w-3xl">
            <Detail label="Video">
              <span className="font-mono text-xs">{job.filePath}</span>
            </Detail>
            <Detail label="Subtitle file">
              {job.outputPath ? <span className="font-mono text-xs">{job.outputPath}</span> : null}
            </Detail>
            <Detail label="Encoding">{job.outputEncoding}</Detail>
            <Detail label="Timing from">
              {job.timingSource ? TIMING_LABELS[job.timingSource] : null}
            </Detail>
            <Detail label="Detected language">
              {job.detectedLang ? languageName(job.detectedLang) : null}
            </Detail>
            <Detail label="Speech-to-text model">
              {job.timingSource === 'stt' ? (
                <span className="font-mono text-xs">{job.sttModel}</span>
              ) : (
                'Not used'
              )}
            </Detail>
            <Detail label="Translation model">
              <span className="font-mono text-xs">{job.translateModel}</span>
            </Detail>
            <Detail label="Audio transcribed">
              {job.audioSeconds ? formatDuration(job.audioSeconds) : null}
            </Detail>
            <Detail label="Tokens">
              <span className="tabular">
                {job.tokensIn.toLocaleString()} in · {job.tokensOut.toLocaleString()} out
              </span>
            </Detail>
            <Detail label="Created">{relativeTime(job.createdAt)}</Detail>
            <Detail label="Took">
              {job.startedAt && job.finishedAt
                ? formatDuration((job.finishedAt - job.startedAt) / 1000)
                : null}
            </Detail>
          </dl>
        </TabsContent>
      </Tabs>
    </div>
  );
}
