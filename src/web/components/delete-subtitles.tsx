import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Job } from '@shared/types';
import { ErrorNote } from '@/components/empty';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';

function fileName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/**
 * Confirms and deletes the subtitle files of one or more finished jobs. By default the jobs are
 * removed from history as well, so the episodes show as not translated again.
 */
export function DeleteSubtitlesDialog({
  jobs,
  open,
  onOpenChange,
  onDeleted,
}: {
  jobs: Job[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDeleted?: (removedJobs: boolean) => void;
}) {
  const qc = useQueryClient();
  const [keepJob, setKeepJob] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const withFile = jobs.filter((j) => j.outputPath);
  const single = jobs.length === 1 ? jobs[0] : undefined;

  const title = single
    ? single.outputPath
      ? `Delete ${fileName(single.outputPath)}?`
      : `Remove the translation of ${single.fileName}?`
    : `Delete the subtitles of ${jobs.length} episodes?`;
  const description =
    withFile.length === 0
      ? 'There is no subtitle file on disk any more. The translation is removed from OSG.'
      : withFile.length === jobs.length
        ? `The .srt file${withFile.length === 1 ? ' is' : 's are'} deleted from disk. Your videos and any other subtitle files are not touched.`
        : `${withFile.length} .srt file${withFile.length === 1 ? ' is' : 's are'} deleted from disk; the others no longer exist. Your videos are not touched.`;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      let files = 0;
      for (const j of jobs) {
        const res = await api.deleteSubtitle(j.id, keepJob && withFile.length > 0);
        if (res.deletedFile) files++;
      }
      toast.success(
        files ? `Deleted ${files} subtitle file${files === 1 ? '' : 's'}` : 'Translation removed',
      );
      void qc.invalidateQueries({ queryKey: ['project-files'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      for (const j of jobs) void qc.invalidateQueries({ queryKey: ['job', j.id] });
      onOpenChange(false);
      onDeleted?.(!keepJob || withFile.length === 0);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        {jobs.length > 1 && (
          <ul className="grid max-h-40 gap-0.5 overflow-y-auto rounded-md border border-line bg-panel-2 px-3 py-2 font-mono text-xs text-muted">
            {jobs.map((j) => (
              <li key={j.id} className="truncate">
                {j.outputPath ? fileName(j.outputPath) : `${j.fileName} (no file)`}
              </li>
            ))}
          </ul>
        )}
        {withFile.length > 0 && (
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <Checkbox
              checked={keepJob}
              onCheckedChange={(v) => setKeepJob(v === true)}
              className="mt-0.5"
            />
            <span>
              Keep the translation in OSG
              <span className="block text-xs text-muted">
                You can open it in the editor and save the .srt again later.
              </span>
            </span>
          </label>
        )}
        <ErrorNote error={error} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void run()} disabled={busy || jobs.length === 0}>
            {busy ? <Spinner /> : <Trash2 />}{' '}
            {withFile.length ? 'Delete subtitles' : 'Remove translation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
