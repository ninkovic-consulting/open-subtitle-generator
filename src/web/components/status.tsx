import { AlertTriangle, Ban, Check, Clock, Loader2 } from 'lucide-react';
import { JOB_STAGES, type Job, type JobStage, type JobStatus } from '@shared/types';
import { STAGE_DESCRIPTIONS, STAGE_LABELS, STATUS_LABELS } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<JobStatus, string> = {
  queued: 'bg-panel-2 text-muted border-line',
  running: 'bg-accent-soft text-accent border-accent/30',
  done: 'bg-ok-soft text-ok border-ok/25',
  failed: 'bg-danger-soft text-danger border-danger/25',
  cancelled: 'bg-panel-2 text-faint border-line',
};

const STATUS_ICON: Record<JobStatus, typeof Check> = {
  queued: Clock,
  running: Loader2,
  done: Check,
  failed: AlertTriangle,
  cancelled: Ban,
};

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        STATUS_STYLE[status],
        className,
      )}
    >
      <Icon className={cn('size-3', status === 'running' && 'animate-spin')} />
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Language chip: blue for source, yellow for translation (the app-wide colour convention). */
export function LangChip({
  code,
  kind,
  className,
}: {
  code: string | null | undefined;
  kind: 'source' | 'target';
  className?: string;
}) {
  if (!code) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-px font-mono text-2xs font-medium',
        kind === 'source' ? 'bg-source-soft text-source' : 'bg-accent-soft text-accent',
        className,
      )}
    >
      {code}
    </span>
  );
}

function stageState(
  job: Pick<Job, 'status' | 'stage' | 'timingSource'>,
  stage: JobStage,
): 'done' | 'active' | 'pending' | 'failed' | 'skipped' {
  const order = JOB_STAGES.indexOf(stage);
  const current = job.stage ? JOB_STAGES.indexOf(job.stage) : -1;
  const skippedStt = job.timingSource && job.timingSource !== 'stt' && stage === 'transcribe';
  if (job.status === 'done') return skippedStt ? 'skipped' : 'done';
  if (order < current) return skippedStt ? 'skipped' : 'done';
  if (order === current) {
    if (job.status === 'failed') return 'failed';
    if (job.status === 'running') return 'active';
    return 'pending';
  }
  return 'pending';
}

/** The six pipeline stages as a connected strip. */
export function StageTimeline({
  job,
  className,
  compact,
}: {
  job: Pick<Job, 'status' | 'stage' | 'timingSource'>;
  className?: string;
  compact?: boolean;
}) {
  return (
    <ol className={cn('flex w-full items-center gap-1', className)}>
      {JOB_STAGES.map((stage, i) => {
        const state = stageState(job, stage);
        // When an existing subtitle gave the timing, stage 3 names what was used instead.
        const skippedLabel =
          job.timingSource === 'embedded_srt' ? 'Subtitle track' : 'Existing .srt';
        const skippedTitle =
          job.timingSource === 'embedded_srt'
            ? 'No transcription needed: timing comes from the embedded subtitle track'
            : 'No transcription needed: timing comes from the .srt next to the video';
        return (
          <li
            key={stage}
            className="flex min-w-0 flex-1 flex-col gap-1.5"
            title={state === 'skipped' ? skippedTitle : STAGE_DESCRIPTIONS[stage]}
          >
            <div
              className={cn(
                'h-1 rounded-full transition-colors duration-500',
                state === 'done' && 'bg-accent-fill',
                state === 'active' && 'bg-accent-fill/50 animate-pulse',
                state === 'failed' && 'bg-danger',
                state === 'skipped' && 'bg-accent-fill/35',
                state === 'pending' && 'bg-line',
              )}
            />
            {!compact && (
              <span
                className={cn(
                  'truncate text-2xs',
                  state === 'active'
                    ? 'text-text font-medium'
                    : state === 'failed'
                      ? 'text-danger'
                      : state === 'done' || state === 'skipped'
                        ? 'text-muted'
                        : 'text-faint',
                )}
              >
                <span className="tabular mr-1 text-faint">{i + 1}</span>
                {state === 'skipped' ? skippedLabel : STAGE_LABELS[stage]}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
