'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { EmailTab } from '@/lib/types';
import { usePolledQuery } from '@/hooks/usePolledQuery';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { EmailTable } from './EmailTable';

const PAGE_SIZE = 20;

const COPY: Record<EmailTab, { title: string; emptyTitle: string; emptyBody: string; noMatch: string }> = {
  scheduled: {
    title: 'Scheduled emails',
    emptyTitle: 'Nothing scheduled',
    emptyBody: 'Emails you schedule appear here until they are sent.',
    noMatch: 'No scheduled emails match your search.',
  },
  sent: {
    title: 'Sent emails',
    emptyTitle: 'No emails sent yet',
    emptyBody: 'Sent and failed emails show up here once their scheduled time passes.',
    noMatch: 'No sent emails match your search.',
  },
};

/** Search + live-refreshing table + pagination. Used by both the Scheduled and Sent pages. */
export function EmailListView({ tab }: { tab: EmailTab }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data, loading, refreshing, error, refetch } = usePolledQuery(
    () => api.listEmails({ tab, q: debounced || undefined, page, pageSize: PAGE_SIZE }),
    `${tab}|${debounced}|${page}`,
    4000,
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const copy = COPY[tab];

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <h1 className="w-full text-lg font-semibold text-ink sm:mr-auto sm:w-auto">{copy.title}</h1>
        <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by recipient, subject or text"
            aria-label="Search emails"
            className="h-9 w-full rounded-full border border-line bg-surface-sunken pl-9 pr-3 text-sm placeholder:text-ink-muted focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <button
          onClick={() => void refetch()}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken hover:text-ink"
          aria-label="Refresh"
          title="Refresh (updates automatically every few seconds)"
        >
          {refreshing && !loading ? <Spinner size={14} /> : <Icon name="refresh" />}
        </button>
      </div>

      {error && (
        <div role="alert" className="mx-5 mt-4 flex items-center gap-2 rounded-lg bg-danger-tint px-4 py-3 text-sm text-danger">
          <Icon name="alert" />
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!loading && items.length === 0 ? (
          debounced ? (
            <EmptyState icon="search" title="No matches" body={copy.noMatch} />
          ) : (
            <EmptyState
              icon={tab === 'scheduled' ? 'clock' : 'inbox'}
              title={copy.emptyTitle}
              body={copy.emptyBody}
              action={
                <ButtonLink href="/dashboard/compose" variant="outline">
                  Compose new email
                </ButtonLink>
              }
            />
          )
        ) : (
          <EmailTable tab={tab} items={items} loading={loading} />
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-ink-muted">
          <span className="tabular-nums">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
