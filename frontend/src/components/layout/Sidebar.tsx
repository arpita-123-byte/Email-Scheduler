'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePolledQuery } from '@/hooks/usePolledQuery';
import { ButtonLink } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { SlackCard } from '@/components/slack/SlackCard';

const NAV: { href: string; label: string; icon: IconName; countKey: 'scheduled' | 'sent' }[] = [
  { href: '/dashboard/scheduled', label: 'Scheduled', icon: 'clock', countKey: 'scheduled' },
  { href: '/dashboard/sent', label: 'Sent', icon: 'send', countKey: 'sent' },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { data: stats } = usePolledQuery(() => api.stats(), 'stats', 5000);

  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-ink/20 lg:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col gap-6 border-r border-line bg-surface-sunken px-4 py-5 transition-transform lg:static lg:z-auto lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <ButtonLink href="/dashboard/compose" variant="outline" className="w-full">
          <Icon name="pencil" size={16} />
          Compose
        </ButtonLink>

        <nav aria-label="Mailboxes">
          <ul className="space-y-1">
            {NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              const count = stats?.[item.countKey];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      active ? 'bg-brand-tint font-medium text-brand-dark' : 'text-ink-soft hover:bg-white hover:text-ink',
                    )}
                  >
                    <Icon name={item.icon} size={17} />
                    <span className="flex-1">{item.label}</span>
                    {count !== undefined && <span className="text-xs tabular-nums text-ink-muted">{count.toLocaleString()}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
          {stats && stats.failed > 0 && (
            <p className="mt-2 px-3 text-xs text-danger">{stats.failed.toLocaleString()} failed (shown under Sent)</p>
          )}
        </nav>

        <div className="mt-auto space-y-3">
          <SlackCard />
          <a
            href={api.queueDashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-white hover:text-ink"
          >
            <Icon name="queue" size={16} />
            Queue dashboard
            <Icon name="external" size={13} className="ml-auto text-ink-muted" />
          </a>
        </div>
      </aside>
    </>
  );
}
