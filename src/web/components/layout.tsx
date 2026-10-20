import { useQuery } from '@tanstack/react-query';
import { BarChart3, Clapperboard, LayoutDashboard, Menu, Plus, Settings, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { ThemeToggle } from '@/components/theme';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Shows & movies', icon: Clapperboard },
  { to: '/costs', label: 'History & costs', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="7" className="fill-screen" />
        <rect x="6" y="18" width="20" height="3.2" rx="1.6" fill="#F2C94C" />
        <rect x="9" y="23" width="14" height="3.2" rx="1.6" fill="#7EA6F6" />
        <circle cx="16" cy="10.5" r="4.5" fill="none" stroke="#ECE8DF" strokeWidth="2" />
      </svg>
      <div className="grid leading-none">
        <span className="text-[17px] font-bold tracking-tight">OSG</span>
        <span className={cn('text-2xs text-muted', compact && 'hidden sm:inline')}>
          Open Subtitle Generator
        </span>
      </div>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const active = useQuery({
    queryKey: ['jobs', 'active'],
    queryFn: () => api.jobs({ status: 'running,queued' }),
    refetchInterval: 15_000,
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 30_000 });
  const running = active.data?.jobs.filter((j) => j.status === 'running').length ?? 0;
  const queued = active.data?.jobs.filter((j) => j.status === 'queued').length ?? 0;
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <NavLink to="/" onClick={onNavigate} className="rounded-md px-1">
        <Logo />
      </NavLink>
      <Button asChild variant="primary" className="w-full justify-start">
        <NavLink to="/new" onClick={onNavigate}>
          <Plus /> New translation
        </NavLink>
      </Button>
      <nav aria-label="Main" className="grid gap-0.5">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors [&_svg]:size-4',
                isActive
                  ? 'bg-panel text-text ring-1 ring-line'
                  : 'text-muted hover:bg-panel/60 hover:text-text',
              )
            }
          >
            <Icon />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto grid gap-3">
        {(running > 0 || queued > 0) && (
          <NavLink
            to="/"
            onClick={onNavigate}
            className="rounded-md border border-line bg-panel px-3 py-2.5 text-xs"
          >
            <div className="flex items-center gap-2 font-medium">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-fill opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-accent-fill" />
              </span>
              {running} running{queued ? `, ${queued} queued` : ''}
            </div>
          </NavLink>
        )}
        <div className="flex items-center justify-between text-2xs text-faint">
          <span>v{settings.data?.meta.version ?? '…'}</span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

function SpendBadge() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 30_000 });
  if (!stats.data) return null;
  return (
    <Tooltip
      content={`Today ${formatUsd(stats.data.todayUsd)} · all time ${formatUsd(stats.data.totalUsd)}`}
    >
      <NavLink
        to="/costs"
        className="flex items-baseline gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-sm hover:bg-panel-2"
      >
        <span className="tabular font-semibold">{formatUsd(stats.data.monthUsd)}</span>
        <span className="text-xs text-muted">this month</span>
      </NavLink>
    </Tooltip>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-bg md:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-bg">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 cursor-pointer p-1 text-muted"
            >
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setOpen(true)}
              className="cursor-pointer rounded-md p-1.5 text-muted hover:text-text"
            >
              <Menu className="size-5" />
            </button>
            <Logo compact />
          </div>
          <div className="hidden md:block" />
          <SpendBadge />
        </header>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
