import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clapperboard, FolderPlus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { EmptyState, ErrorNote, PageHeader } from '@/components/empty';
import { FileBrowser } from '@/components/file-browser';
import { LanguagePicker } from '@/components/language-picker';
import { LangChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Progress, Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { formatUsd, relativeTime } from '@/lib/format';

/** Suggested project name; season folders get the show name in front ("Show – Season 01"). */
function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  const name = parts.pop() ?? p;
  const parent = parts.pop();
  return parent && /^(season|series|staffel|sezona|saison|temporada|stagione|s)\s*\d+$/i.test(name)
    ? `${parent} – ${name}`
    : name;
}

export function AddFolderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [folder, setFolder] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const onFolderChange = useCallback(
    (p: string) => {
      setFolder(p);
      if (!nameTouched) setName(basename(p));
    },
    [nameTouched],
  );
  const create = useMutation({
    mutationFn: () =>
      api.createProject({
        name: name.trim() || basename(folder),
        rootPath: folder,
        defaultSourceLang: source ?? settings.data?.settings.defaultSourceLang ?? 'auto',
        defaultTargetLang: target ?? settings.data?.settings.defaultTargetLang ?? 'hr',
      }),
    onSuccess: ({ project }) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(`Added ${project.name}`, {
        description: `${project.fileCount} video file(s) found`,
      });
      onOpenChange(false);
      navigate(`/projects/${project.id}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl"
        title="Add a show or movie folder"
        description="Pick the folder of a season, a whole show or a movie. OSG lists every video inside it, including subfolders."
      >
        <FileBrowser mode="folder" onFolderChange={onFolderChange} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" htmlFor="project-name">
            <Input
              id="project-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
            />
          </Field>
          <Field label="Spoken language" htmlFor="project-source">
            <LanguagePicker
              id="project-source"
              allowAuto
              value={source ?? settings.data?.settings.defaultSourceLang ?? 'auto'}
              onChange={(c) => setSource(c)}
            />
          </Field>
          <Field label="Subtitle language" htmlFor="project-target">
            <LanguagePicker
              id="project-target"
              value={target ?? settings.data?.settings.defaultTargetLang ?? 'hr'}
              onChange={(c) => setTarget(c)}
            />
          </Field>
        </div>
        <ErrorNote error={create.error} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!folder || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? <Spinner /> : <FolderPlus />} Add this folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsPage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [adding, setAdding] = useState(false);
  const list = projects.data?.projects ?? [];
  return (
    <div className="grid gap-8">
      <PageHeader
        title="Shows & movies"
        description="Each folder keeps its own character sheet and glossary, so a whole season is translated consistently."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <FolderPlus /> Add folder
          </Button>
        }
      />
      {projects.isLoading && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading…
        </p>
      )}
      {projects.data && list.length === 0 && (
        <EmptyState
          icon={<Clapperboard />}
          title="No folders yet"
          description="Add the folder of a season or a movie. You can also start a translation directly; the folder is added for you."
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              <FolderPlus /> Add folder
            </Button>
          }
        />
      )}
      {list.length > 0 && (
        <ul className="divide-y divide-line border-y border-line">
          {list.map((p) => {
            const ratio = p.fileCount ? p.doneCount / p.fileCount : 0;
            return (
              <li key={p.id}>
                <Link
                  to={`/projects/${p.id}`}
                  className="grid gap-3 py-4 hover:bg-panel/50 sm:grid-cols-[1fr_220px_90px] sm:items-center sm:gap-8 sm:px-2"
                >
                  <div className="grid min-w-0 gap-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-lg font-semibold">{p.name}</span>
                      <LangChip code={p.defaultTargetLang} kind="target" />
                    </span>
                    <span className="truncate font-mono text-xs text-muted">{p.rootPath}</span>
                  </div>
                  <div className="grid gap-1.5">
                    <Progress value={ratio} />
                    <span className="tabular text-xs text-muted">
                      {p.doneCount} of {p.fileCount} subtitled · updated {relativeTime(p.updatedAt)}
                    </span>
                  </div>
                  <span className="tabular text-sm sm:text-right">{formatUsd(p.costUsd)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <AddFolderDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}
