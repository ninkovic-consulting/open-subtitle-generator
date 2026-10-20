import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Tv } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Job, Naming, OutputEncoding } from '@shared/types';
import { ErrorNote } from '@/components/empty';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/ui/label';
import { Spinner } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { ENCODING_OPTIONS, NAMING_OPTIONS } from '@/pages/new-translation';

/**
 * Writes the subtitle files of one or more finished jobs again from the stored translation (with
 * edits), in the chosen name and encoding. No new API calls. Files the job wrote earlier under
 * another name are replaced.
 */
export function SaveSubtitlesDialog({
  jobs,
  open,
  onOpenChange,
}: {
  jobs: Job[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const single = jobs.length === 1 ? jobs[0] : undefined;
  const [naming, setNaming] = useState<Naming | null>(null);
  const [encoding, setEncoding] = useState<OutputEncoding | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const nam = naming ?? single?.options.naming ?? settings.data?.settings.naming ?? 'lang-suffix';
  const enc =
    encoding ?? single?.options.encoding ?? settings.data?.settings.encoding ?? 'utf8-bom';

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const files: string[] = [];
      const notes: string[] = [];
      let fellBack = false;
      for (const j of jobs) {
        const r = await api.exportJob(j.id, {
          naming: nam,
          encoding: enc,
          overwrite: true,
          replacePrevious: true,
        });
        files.push(...r.paths.map((p) => p.split(/[\\/]/).pop() ?? p));
        notes.push(...r.skipped);
        fellBack ||= r.fellBack;
      }
      toast.success(`Saved ${files.length} subtitle file${files.length === 1 ? '' : 's'}`, {
        description: files.length <= 4 ? files.join(', ') : undefined,
      });
      for (const n of notes.slice(0, 3)) toast.warning(n);
      if (fellBack)
        toast.warning(
          'Some characters do not exist in the legacy code page, so UTF-8 with BOM was used.',
        );
      void qc.invalidateQueries({ queryKey: ['project-files'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      for (const j of jobs) void qc.invalidateQueries({ queryKey: ['job', j.id] });
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={single ? 'Save subtitle file' : `Save subtitle files of ${jobs.length} episodes`}
        description="Writes the translated lines, including your edits, next to the video. Nothing is translated again."
      >
        <Field
          label="File name"
          htmlFor="save-name"
          hint={NAMING_OPTIONS.find((o) => o.value === nam)?.description}
        >
          <Select
            id="save-name"
            value={nam}
            options={NAMING_OPTIONS.map(({ value, label }) => ({ value, label }))}
            onValueChange={setNaming}
          />
        </Field>
        <Field
          label="Encoding"
          htmlFor="save-enc"
          hint={ENCODING_OPTIONS.find((o) => o.value === enc)?.description}
        >
          <Select
            id="save-enc"
            value={enc}
            options={ENCODING_OPTIONS.map(({ value, label }) => ({ value, label }))}
            onValueChange={setEncoding}
          />
        </Field>
        <div className="flex gap-3 rounded-md border border-line bg-panel-2 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <Tv className="mt-0.5 size-4 shrink-0 text-source" />
          <p>
            <span className="font-medium text-text">Watching on a TV from USB?</span> Samsung, LG
            and most TVs only load a subtitle named exactly like the video, so choose <em>Both</em>{' '}
            or <em>Episode.srt</em>. If č ć đ š ž look wrong, set the TV’s subtitle Encoding to
            UTF-8, or save as <em>Legacy code page</em> here and pick <em>Central European</em> on
            the TV.
          </p>
        </div>
        <ErrorNote error={error} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={busy || jobs.length === 0}>
            {busy ? <Spinner /> : <Download />} Save{' '}
            {jobs.length > 1 ? `${jobs.length} files` : 'subtitle file'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
