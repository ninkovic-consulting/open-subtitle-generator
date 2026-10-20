import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorNote, PageHeader } from '@/components/empty';
import { Panel, Section, Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/format';

const KIND_LABEL: Record<string, string> = {
  stt: 'Speech-to-text',
  translate: 'Translation',
  context: 'Character sheet',
  test: 'Connection tests',
};

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="tabular text-xl font-semibold">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

export function CostsPage() {
  const q = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  if (q.error) return <ErrorNote error={q.error} />;
  const s = q.data;
  if (!s) return <Spinner />;
  const days = s.byDay.map((d) => ({ ...d, label: d.day.slice(5).replace('-', '/') }));
  const done = s.jobCounts.done;

  return (
    <div className="grid gap-10">
      <PageHeader
        title="History & costs"
        description="Every request is logged with its real cost as reported by the provider. Local endpoints count as free."
      />

      <div className="flex flex-wrap gap-x-12 gap-y-4 border-y border-line py-5">
        <Figure label="This month" value={formatUsd(s.monthUsd)} />
        <Figure label="Today" value={formatUsd(s.todayUsd)} />
        <Figure label="All time" value={formatUsd(s.totalUsd)} />
        <Figure label="Subtitles made" value={String(done)} />
        <Figure label="Average per subtitle" value={done ? formatUsd(s.totalUsd / done) : '—'} />
        <Figure label="Audio transcribed" value={`${s.audioHours.toFixed(1)} h`} />
      </div>

      <Section title="Spend per day" description="Last 30 days.">
        <Panel className="h-64 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={days} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--faint)', fontSize: 11 }}
                interval={4}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                tick={{ fill: 'var(--faint)', fontSize: 11 }}
                tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              />
              <Tooltip
                cursor={{ fill: 'var(--panel-2)' }}
                contentStyle={{
                  background: 'var(--panel)',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  color: 'var(--text)',
                  fontSize: 12,
                }}
                formatter={(v) => [formatUsd(Number(v), 4), 'Spend']}
                labelFormatter={(l) => String(l)}
              />
              <Bar
                dataKey="costUsd"
                fill="var(--accent-fill)"
                radius={[3, 3, 0, 0]}
                maxBarSize={22}
              />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="By show or movie">
          {s.byProject.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2 font-medium">Folder</th>
                  <th className="pb-2 text-right font-medium">Jobs</th>
                  <th className="pb-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {s.byProject.map((p) => (
                  <tr key={p.projectId ?? 'none'} className="border-t border-line">
                    <td className="py-2 pr-3">{p.name}</td>
                    <td className="tabular py-2 text-right text-muted">{p.jobs}</td>
                    <td className="tabular py-2 text-right">{formatUsd(p.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
        <Section title="By model">
          {s.byModel.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2 font-medium">Model</th>
                  <th className="pb-2 font-medium">Used for</th>
                  <th className="pb-2 text-right font-medium">Calls</th>
                  <th className="pb-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {s.byModel.map((m) => (
                  <tr key={`${m.model}-${m.kind}`} className="border-t border-line">
                    <td className="max-w-[220px] truncate py-2 pr-3 font-mono text-xs">
                      {m.model}
                    </td>
                    <td className="py-2 pr-3 text-muted">{KIND_LABEL[m.kind] ?? m.kind}</td>
                    <td className="tabular py-2 text-right text-muted">{m.calls}</td>
                    <td className="tabular py-2 text-right">{formatUsd(m.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
  );
}
