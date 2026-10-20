import { Laptop, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Tooltip } from '@/components/ui/tooltip';

type Theme = 'system' | 'light' | 'dark';

function apply(theme: Theme) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('osg-theme') as Theme | null) ?? 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    apply(theme);
    try {
      if (theme === 'system') localStorage.removeItem('osg-theme');
      else localStorage.setItem('osg-theme', theme);
    } catch {
      // ignore
    }
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
  const next: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const Icon = theme === 'system' ? Laptop : theme === 'light' ? Sun : Moon;
  const label = `Theme: ${theme}. Switch to ${next}`;
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={() => setTheme(next)}
        className="grid size-8 cursor-pointer place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-text"
      >
        <Icon className="size-4" />
      </button>
    </Tooltip>
  );
}
