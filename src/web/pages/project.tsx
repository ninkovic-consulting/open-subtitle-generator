import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Captions,
  Download,
  FolderOpen,
  Languages,
  MoreHorizontal,
  PenLine,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { Glossary, Job, MediaFile } from '@shared/types';
import { DeleteSubtitlesDialog } from '@/components/delete-subtitles';
import { SaveSubtitlesDialog } from '@/components/save-subtitles';
import { EmptyState, ErrorNote, PageHeader } from '@/components/empty';
import { LangChip, StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { formatDuration, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

function timingHint(f: MediaFile): string | null {
  if (f.sidecarSubtitles.length)
    return `Subtitle file next to the video: ${f.sidecarSubtitles.join(', ')}`;
  const t = f.subtitleTracks.find((s) => s.textBased);
  if (t) return `Embedded ${t.codec} subtitle track${t.language ? ` (${t.language})` : ''}`;
  return null;
}

function EpisodeTable({ projectId, files }: { projectId: number; files: MediaFile[] }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const all = files.length > 0 && files.every((f) => selected.has(f.id));
  const some = files.some((f) => selected.has(f.id));
  const toggle = (id: number, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const translate = (ids: number[]) => navigate(`/new?project=${projectId}&media=${ids.join(',')}`);
  const untranslated = files.filter((f) => f.latestJob?.status !== 'done').map((f) => f.id);
  const [deleting, setDeleting] = useState<Job[]>([]);
  const [saving, setSaving] = useState<Job[]>([]);
  const selectedDone = files
    .filter((f) => selected.has(f.id) && f.latestJob?.status === 'done')
    .map((f) => f.latestJob!);
  const deletable = (f: MediaFile) =>
    f.latestJob && f.latestJob.status !== 'running' && f.latestJob.status !== 'queued'
      ? f.latestJob
      : null;
  const selectedDeletable = files
    .filter((f) => selected.has(f.id))
    .map(deletable)
    .filter((j): j is Job => !!j && (j.status === 'done' || !!j.outputPath));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!some} onClick={() => translate([...selected])}>
          <Languages /> Translate {some ? `${selected.size} selected` : 'selected'}
        </Button>
        {untranslated.length > 0 && untranslated.length !== files.length && (
          <Button variant="secondary" onClick={() => translate(untranslated)}>
            Translate the {untranslated.length} without subtitles
          </Button>
        )}
        {selectedDone.length > 0 && (
          <Button variant="secondary" onClick={() => setSaving(selectedDone)}>
            <Download /> Save subtitle files of {selectedDone.length}…
          </Button>
        )}
        {selectedDeletable.length > 0 && (
          <Button variant="danger" onClick={() => setDeleting(selectedDeletable)}>
            <Trash2 /> Delete subtitles of {selectedDeletable.length}
          </Button>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-panel-2 text-left text-xs text-muted">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  aria-label="Select all"
                  checked={all ? true : some ? 'indeterminate' : false}
                  onCheckedChange={(v) =>
                    setSelected(v === true ? new Set(files.map((f) => f.id)) : new Set())
                  }
                />
              </th>
              <th className="px-2 py-2 font-medium">Episode</th>
              <th className="w-20 px-2 py-2 text-right font-medium">Length</th>
              <th className="w-16 px-2 py-2 text-center font-medium">
                <Tooltip content="An existing subtitle (file or embedded text track) can be used for timing, so no speech-to-text is needed">
                  <span className="cursor-help">Timing</span>
                </Tooltip>
              </th>
              <th className="w-28 px-2 py-2 font-medium">Status</th>
              <th className="w-20 px-2 py-2 font-medium">Language</th>
              <th className="w-20 px-2 py-2 text-right font-medium">Cost</th>
              <th className="w-24 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {files.map((f) => {
              const job = f.latestJob;
              const hint = timingHint(f);
              return (
                <tr
                  key={f.id}
                  className={cn('border-t border-line', selected.has(f.id) && 'bg-accent-soft/40')}
                >
                  <td className="px-3 py-2.5">
                    <Checkbox
                      aria-label={`Select ${f.fileName}`}
                      checked={selected.has(f.id)}
                      onCheckedChange={(v) => toggle(f.id, v === true)}
                    />
                  </td>
                  <td className="max-w-0 px-2 py-2.5">
                    <span className="block truncate font-medium" title={f.path}>
                      {f.fileName}
                    </span>
                    {job?.status === 'failed' && (
                      <span className="block truncate text-xs text-danger">{job.error}</span>
                    )}
                  </td>
                  <td className="tabular px-2 py-2.5 text-right text-muted">
                    {formatDuration(f.durationSec)}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    {hint ? (
                      <Tooltip content={hint}>
                        <Captions className="mx-auto size-4 text-ok" aria-label={hint} />
                      </Tooltip>
                    ) : (
                      <span className="text-faint" aria-label="Needs speech-to-text">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    {job ? (
                      <span className="flex flex-col items-start gap-0.5">
                        <StatusBadge status={job.status} />
                        {job.status === 'done' && !job.outputPath && (
                          <span className="text-2xs text-muted">File deleted</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-faint">Not started</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    {job && <LangChip code={job.targetLang} kind="target" />}
                  </td>
                  <td className="tabular px-2 py-2.5 text-right">
                    {job ? formatUsd(job.costUsd) : ''}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex justify-end gap-0.5">
                      {job?.status === 'done' && (
                        <Tooltip content="Open in editor">
                          <Button asChild variant="ghost" size="icon-sm">
                            <Link to={`/jobs/${job.id}/editor`} aria-label="Open in editor">
                              <PenLine />
                            </Link>
                          </Button>
                        </Tooltip>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="More actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => translate([f.id])}>
                            <Languages /> Translate…
                          </DropdownMenuItem>
                          {job && (
                            <DropdownMenuItem onSelect={() => navigate(`/jobs/${job.id}`)}>
                              <Terminal /> Open log
                            </DropdownMenuItem>
                          )}
                          {job?.outputPath && (
                            <DropdownMenuItem
                              onSelect={() =>
                                api
                                  .reveal(job.outputPath!)
                                  .catch((e: Error) => toast.error(e.message))
                              }
                            >
                              <FolderOpen /> Show subtitle file
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onSelect={() =>
                              api.reveal(f.path).catch((e: Error) => toast.error(e.message))
                            }
                          >
                            <FolderOpen /> Show video
                          </DropdownMenuItem>
                          {f.latestJob?.status === 'done' && (
                            <DropdownMenuItem onSelect={() => setSaving([f.latestJob!])}>
                              <Download /> Save subtitle file…
                            </DropdownMenuItem>
                          )}
                          {deletable(f) && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-danger"
                                onSelect={() => setDeleting([deletable(f)!])}
                              >
                                <Trash2 />{' '}
                                {f.latestJob?.outputPath
                                  ? 'Delete subtitles…'
                                  : 'Remove translation…'}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SaveSubtitlesDialog
        jobs={saving}
        open={saving.length > 0}
        onOpenChange={(v) => !v && setSaving([])}
      />
      <DeleteSubtitlesDialog
        jobs={deleting}
        open={deleting.length > 0}
        onOpenChange={(v) => !v && setDeleting([])}
        onDeleted={() => setSelected(new Set())}
      />
    </div>
  );
}

const GENDER_OPTIONS = [
  { value: 'm' as const, label: 'Male' },
  { value: 'f' as const, label: 'Female' },
  { value: 'u' as const, label: 'Unknown' },
];

function RowButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
      <Trash2 />
    </Button>
  );
}

export function GlossaryEditor({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['glossary', projectId], queryFn: () => api.glossary(projectId) });
  const [g, setG] = useState<Glossary | null>(null);
  useEffect(() => {
    if (q.data) setG(structuredClone(q.data.glossary));
  }, [q.data]);
  const dirty = useMemo(
    () => g && q.data && JSON.stringify(g) !== JSON.stringify(q.data.glossary),
    [g, q.data],
  );
  const save = useMutation({
    mutationFn: (glossary: Glossary) => api.saveGlossary(projectId, glossary),
    onSuccess: (res) => {
      qc.setQueryData(['glossary', projectId], res);
      toast.success('Glossary saved');
    },
  });
  if (!g) return <Spinner />;
  const update = (fn: (draft: Glossary) => void) => {
    const next = structuredClone(g);
    fn(next);
    setG(next);
  };

  return (
    <div className="grid gap-10">
      <div className="sticky top-14 z-10 -mx-1 flex items-center justify-between gap-3 bg-bg/90 px-1 py-2 backdrop-blur">
        <p className="max-w-prose text-sm text-muted">
          Filled in automatically from each episode's transcript and used by every future job in
          this folder. Edits you make here always win.
        </p>
        <Button
          variant="primary"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(g)}
        >
          {save.isPending && <Spinner />} Save glossary
        </Button>
      </div>

      <section className="grid gap-3">
        <div>
          <h3 className="font-semibold">Characters</h3>
          <p className="text-sm text-muted">
            Gender decides grammatical forms such as “bio sam / bila sam”.
          </p>
        </div>
        <div className="grid gap-2">
          {g.characters.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_130px_2fr_auto] items-center gap-2">
              <Input
                aria-label="Name"
                value={c.name}
                placeholder="Name"
                onChange={(e) => update((d) => void (d.characters[i]!.name = e.target.value))}
              />
              <Select
                value={c.gender}
                options={GENDER_OPTIONS}
                onValueChange={(v) => update((d) => void (d.characters[i]!.gender = v))}
              />
              <Input
                aria-label="Notes"
                value={c.notes}
                placeholder="Notes (role, relationships)"
                onChange={(e) => update((d) => void (d.characters[i]!.notes = e.target.value))}
              />
              <RowButton
                label={`Remove ${c.name}`}
                onClick={() => update((d) => void d.characters.splice(i, 1))}
              />
            </div>
          ))}
          <Button
            variant="ghost"
            className="justify-self-start"
            onClick={() =>
              update((d) => void d.characters.push({ name: '', gender: 'u', notes: '' }))
            }
          >
            <Plus /> Add character
          </Button>
        </div>
      </section>

      <section className="grid gap-3">
        <div>
          <h3 className="font-semibold">Forms of address</h3>
          <p className="text-sm text-muted">
            Who says informal “ti” and who says formal “Vi” to whom.
          </p>
        </div>
        <div className="grid gap-2">
          {g.formality.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_130px_1.5fr_auto] items-center gap-2">
              <Input
                aria-label="Speaker"
                value={f.speaker}
                placeholder="Speaker"
                onChange={(e) => update((d) => void (d.formality[i]!.speaker = e.target.value))}
              />
              <Input
                aria-label="Addressee"
                value={f.addressee}
                placeholder="Talks to"
                onChange={(e) => update((d) => void (d.formality[i]!.addressee = e.target.value))}
              />
              <Select
                value={f.form}
                options={[
                  { value: 'informal', label: 'Informal' },
                  { value: 'formal', label: 'Formal' },
                ]}
                onValueChange={(v) => update((d) => void (d.formality[i]!.form = v))}
              />
              <Input
                aria-label="Notes"
                value={f.notes}
                placeholder="Notes"
                onChange={(e) => update((d) => void (d.formality[i]!.notes = e.target.value))}
              />
              <RowButton
                label="Remove rule"
                onClick={() => update((d) => void d.formality.splice(i, 1))}
              />
            </div>
          ))}
          <Button
            variant="ghost"
            className="justify-self-start"
            onClick={() =>
              update(
                (d) =>
                  void d.formality.push({
                    speaker: '',
                    addressee: '',
                    form: 'informal',
                    notes: '',
                  }),
              )
            }
          >
            <Plus /> Add rule
          </Button>
        </div>
      </section>

      <section className="grid gap-3">
        <div>
          <h3 className="font-semibold">Terms</h3>
          <p className="text-sm text-muted">
            Names, places, ranks and recurring phrases with their fixed translation.
          </p>
        </div>
        <div className="grid gap-2">
          {g.terms.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1.5fr_auto] items-center gap-2">
              <Input
                aria-label="Source term"
                className="text-source"
                value={t.source}
                placeholder="Original"
                onChange={(e) => update((d) => void (d.terms[i]!.source = e.target.value))}
              />
              <Input
                aria-label="Translation"
                className="text-accent"
                value={t.target}
                placeholder="Translation"
                onChange={(e) => update((d) => void (d.terms[i]!.target = e.target.value))}
              />
              <Input
                aria-label="Notes"
                value={t.notes}
                placeholder="Notes"
                onChange={(e) => update((d) => void (d.terms[i]!.notes = e.target.value))}
              />
              <RowButton
                label={`Remove ${t.source}`}
                onClick={() => update((d) => void d.terms.splice(i, 1))}
              />
            </div>
          ))}
          <Button
            variant="ghost"
            className="justify-self-start"
            onClick={() => update((d) => void d.terms.push({ source: '', target: '', notes: '' }))}
          >
            <Plus /> Add term
          </Button>
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="font-semibold">Style notes</h3>
        <Textarea
          value={g.styleNotes}
          onChange={(e) => update((d) => void (d.styleNotes = e.target.value))}
          placeholder="Tone, era, slang, register…"
          className="max-w-3xl"
        />
      </section>
    </div>
  );
}

export function ProjectPage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const project = useQuery({ queryKey: ['projects', id], queryFn: () => api.project(id) });
  const files = useQuery({ queryKey: ['project-files', id], queryFn: () => api.projectFiles(id) });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scan = useMutation({
    mutationFn: () => api.scanProject(id),
    onSuccess: (r) => {
      qc.setQueryData(['project-files', id], { files: r.files });
      toast.success(`Found ${r.found} video file(s)`);
    },
  });
  const del = useMutation({
    mutationFn: () => api.deleteProject(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      navigate('/projects');
    },
  });
  const p = project.data?.project;
  if (project.error) return <ErrorNote error={project.error} />;
  if (!p) return <Spinner />;

  return (
    <div className="grid gap-8">
      <PageHeader
        title={p.name}
        description={<span className="font-mono text-xs">{p.rootPath}</span>}
        actions={
          <>
            <Button variant="secondary" onClick={() => scan.mutate()} disabled={scan.isPending}>
              {scan.isPending ? <Spinner /> : <RefreshCw />} Rescan folder
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem className="text-danger" onSelect={() => setConfirmDelete(true)}>
                  <Trash2 /> Remove from OSG
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        <p className="tabular text-sm text-muted">
          {p.doneCount} of {p.fileCount} subtitled · {formatUsd(p.costUsd)} spent · subtitles in{' '}
          <LangChip code={p.defaultTargetLang} kind="target" />
        </p>
      </PageHeader>

      <Tabs defaultValue="episodes">
        <TabsList>
          <TabsTrigger value="episodes">Episodes</TabsTrigger>
          <TabsTrigger value="glossary">Characters & glossary</TabsTrigger>
        </TabsList>
        <TabsContent value="episodes">
          {files.data && files.data.files.length === 0 ? (
            <EmptyState
              title="No video files in this folder"
              description="Supported: MKV, MP4, M4V, AVI, MOV, WMV, TS, WebM and more. Add videos to the folder and rescan."
            />
          ) : files.data ? (
            <EpisodeTable projectId={id} files={files.data.files} />
          ) : (
            <Spinner />
          )}
        </TabsContent>
        <TabsContent value="glossary">
          <GlossaryEditor projectId={id} />
        </TabsContent>
      </Tabs>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent
          title={`Remove “${p.name}” from OSG?`}
          description="Jobs, logs, edited cues and the glossary of this folder are deleted from OSG. Your videos and .srt files on disk are not touched."
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => del.mutate()} disabled={del.isPending}>
              <Trash2 /> Remove from OSG
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
