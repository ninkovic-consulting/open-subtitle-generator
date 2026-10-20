import { useQuery } from '@tanstack/react-query';
import { Copy, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { JobLog, LogLevel } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { clockTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: 'text-faint',
  info: 'text-muted',
  warn: 'text-warn',
  error: 'text-danger',
};

export function LogViewer({ jobId, live }: { jobId: number; live: boolean }) {
  const logs = useQuery({
    queryKey: ['logs', jobId],
    queryFn: () => api.logs(jobId),
    refetchInterval: live ? 10_000 : false,
  });
  const [level, setLevel] = useState<LogLevel>('info');
  const [q, setQ] = useState('');
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (logs.data?.logs ?? []).filter(
      (l) =>
        ORDER[l.level] >= ORDER[level] &&
        (!needle || l.message.toLowerCase().includes(needle) || (l.stage ?? '').includes(needle)),
    );
  }, [logs.data, level, q]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [rows.length, follow]);

  const copy = async () => {
    const text = rows
      .map(
        (l: JobLog) =>
          `${new Date(l.ts).toISOString()} ${l.level.toUpperCase()} [${l.stage ?? '-'}] ${l.message}${l.data ? ` ${JSON.stringify(l.data)}` : ''}`,
      )
      .join('\n');
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${rows.length} log lines`);
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel="Minimum log level"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'debug', label: 'All' },
            { value: 'info', label: 'Info' },
            { value: 'warn', label: 'Warnings' },
            { value: 'error', label: 'Errors' },
          ]}
        />
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search log"
            className="pl-8"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <Switch checked={follow} onCheckedChange={setFollow} /> Auto-scroll
        </label>
        <Button variant="ghost" size="sm" onClick={copy}>
          <Copy /> Copy
        </Button>
      </div>
      <div
        ref={box}
        className="max-h-[480px] overflow-y-auto rounded-lg border border-line bg-screen p-3 font-mono text-xs leading-relaxed text-[#cfd5e1]"
      >
        {rows.length === 0 && <p className="text-[#7c8496]">No log lines yet.</p>}
        {rows.map((l) => (
          <div key={l.id} className="grid grid-cols-[auto_auto_1fr] gap-3">
            <span className="tabular text-[#6b7386]">{clockTime(l.ts)}</span>
            <span
              className={cn(
                'w-20 truncate',
                l.level === 'info' ? 'text-[#8fa3c7]' : LEVEL_STYLE[l.level],
              )}
            >
              {l.stage ?? '—'}
            </span>
            <span
              className={cn(
                'whitespace-pre-wrap break-words',
                l.level === 'warn' && 'text-[#f0b46e]',
                l.level === 'error' && 'text-[#f38a90]',
                l.level === 'debug' && 'text-[#7c8496]',
              )}
            >
              {l.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
