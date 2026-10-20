import type { JobStage, JobStatus, TimingSource } from '@shared/types';

export function formatUsd(v: number | null | undefined, digits?: number): string {
  const n = v ?? 0;
  const d = digits ?? (n === 0 ? 2 : n < 0.01 ? 4 : n < 1 ? 3 : 2);
  return `$${n.toFixed(d)}`;
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}

/** `HH:MM:SS,mmm` as used in SRT files. */
export function timecode(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const f = t % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(f, 3)}`;
}

export function parseTimecode(value: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/.exec(value.trim());
  if (!m) return null;
  return (
    ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 +
    Number((m[4] ?? '0').padEnd(3, '0'))
  );
}

export function formatBytes(n: number | undefined): string {
  if (!n) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 7 * 86_400) return `${Math.round(diff / 86_400)} d ago`;
  return new Date(ts).toLocaleDateString();
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const STAGE_LABELS: Record<JobStage, string> = {
  probe: 'Probe',
  extract: 'Audio',
  transcribe: 'Transcribe',
  context: 'Characters',
  translate: 'Translate',
  write: 'Write',
};

export const STAGE_DESCRIPTIONS: Record<JobStage, string> = {
  probe: 'Reading the video file',
  extract: 'Extracting the audio track',
  transcribe: 'Transcribing speech',
  context: 'Building the character sheet',
  translate: 'Translating lines',
  write: 'Writing the subtitle file',
};

export const STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const TIMING_LABELS: Record<TimingSource, string> = {
  stt: 'Speech-to-text',
  sidecar_srt: 'Existing .srt file',
  embedded_srt: 'Embedded subtitle track',
};

export function cps(text: string, startMs: number, endMs: number): number {
  const chars = text
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim().length;
  const sec = Math.max(0.001, (endMs - startMs) / 1000);
  return chars / sec;
}
