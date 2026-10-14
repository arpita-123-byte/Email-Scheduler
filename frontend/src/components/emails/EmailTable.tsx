'use client';

import Link from 'next/link';
import type { EmailItem, EmailTab } from '@/lib/types';
import { formatRelative } from '@/lib/format';
import { StatusBadge } from './StatusBadge';

const COLUMNS: Record<EmailTab, { time: string }> = {
  scheduled: { time: 'Scheduled for' },
  sent: { time: 'Sent at' },
};

/**
 * Shared table for both tabs. Each row reads like an inbox line
 * ("To: recipient — subject · preview") with the time and status on the right.
 */
export function EmailTable({ tab, items, loading }: { tab: EmailTab; items: EmailItem[]; loading: boolean }) {
  if (loading) return <TableSkeleton />;

  return (
    <>
      <MobileList tab={tab} items={items} />
      <div className="hidden md:block">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium text-ink-muted">
            <th className="w-[28%] px-5 py-3 font-medium">Email</th>
            <th className="px-3 py-3 font-medium">Subject</th>
            <th className="w-[19%] px-3 py-3 font-medium">{COLUMNS[tab].time}</th>
            <th className="w-[14%] px-5 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => {
            const time = tab === 'sent' ? (e.sentAt ?? e.updatedAt) : e.scheduledAt;
            return (
              <tr key={e.id} className="group border-b border-line last:border-0 hover:bg-surface-sunken">
                <td className="truncate px-5 py-3.5">
                  <Link href={`/dashboard/emails/${e.id}`} className="text-ink focus:outline-none focus-visible:underline">
                    <span className="text-ink-muted">To: </span>
                    {e.toEmail}
                  </Link>
                </td>
                <td className="truncate px-3 py-3.5">
                  <span className="font-medium text-ink">{e.subject}</span>
                  <span className="text-ink-muted"> · {e.body.replace(/\s+/g, ' ').slice(0, 120)}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-3.5 tabular-nums text-ink-soft">
                  {tab === 'sent' && e.status === 'FAILED' && !e.sentAt ? (
                    <span title={e.error ?? undefined}>{formatRelative(time)}</span>
                  ) : (
                    formatRelative(time)
                  )}
                </td>
                <td className="px-5 py-3.5">
                  <StatusBadge status={e.status} rescheduled={e.rescheduledCount} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}

/** Below md the four columns don't fit, so each email becomes a stacked row. */
function MobileList({ tab, items }: { tab: EmailTab; items: EmailItem[] }) {
  return (
    <ul className="divide-y divide-line md:hidden">
      {items.map((e) => (
        <li key={e.id}>
          <Link href={`/dashboard/emails/${e.id}`} className="block px-5 py-3.5 hover:bg-surface-sunken">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                <span className="text-ink-muted">To: </span>
                {e.toEmail}
              </span>
              <StatusBadge status={e.status} rescheduled={e.rescheduledCount} />
            </div>
            <p className="mt-1 truncate text-sm font-medium text-ink">{e.subject}</p>
            <p className="mt-0.5 text-xs tabular-nums text-ink-muted">
              {formatRelative(tab === 'sent' ? (e.sentAt ?? e.updatedAt) : e.scheduledAt)}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TableSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading emails" className="divide-y divide-line">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-6 px-5 py-4">
          <div className="h-3 w-1/4 rounded bg-surface-sunken" />
          <div className="h-3 flex-1 rounded bg-surface-sunken" />
          <div className="h-3 w-24 rounded bg-surface-sunken" />
          <div className="h-5 w-20 rounded-full bg-surface-sunken" />
        </div>
      ))}
    </div>
  );
}
