'use client';

import { use } from 'react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { usePolledQuery } from '@/hooks/usePolledQuery';
import { Avatar } from '@/components/ui/Avatar';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge } from '@/components/emails/StatusBadge';

export default function EmailDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading, error } = usePolledQuery(() => api.getEmail(id), `email:${id}`, 4000);
  const email = data?.email;
  const back = email && (email.status === 'SENT' || email.status === 'FAILED') ? '/dashboard/sent' : '/dashboard/scheduled';

  return (
    <article className="mx-auto w-full max-w-3xl">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <ButtonLink href={back} variant="ghost" size="sm" className="-ml-2 !px-2">
          <Icon name="back" />
          <span className="sr-only">Back</span>
        </ButtonLink>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">{email?.subject ?? (loading ? '' : 'Email')}</h1>
        {email && <StatusBadge status={email.status} rescheduled={email.rescheduledCount} />}
      </div>

      {loading ? (
        <div className="space-y-3 px-5 py-6">
          <div className="h-4 w-1/2 animate-pulse rounded bg-surface-sunken" />
          <div className="h-32 animate-pulse rounded bg-surface-sunken" />
        </div>
      ) : error || !email ? (
        <EmptyState icon="alert" title="Email not found" body={error ?? 'It may have been removed.'} />
      ) : (
        <div className="px-5 py-6">
          <div className="flex items-start gap-3">
            <Avatar name={email.sender.name} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-ink">
                {email.sender.name} <span className="font-normal text-ink-muted">&lt;{email.sender.email}&gt;</span>
              </p>
              <p className="text-ink-muted">To: {email.toEmail}</p>
            </div>
            <p className="whitespace-nowrap text-right text-xs text-ink-muted">
              {email.sentAt ? `Sent ${formatDateTime(email.sentAt)}` : `Scheduled ${formatDateTime(email.scheduledAt)}`}
            </p>
          </div>

          <div className="mt-6 whitespace-pre-wrap rounded-xl bg-surface-sunken px-5 py-4 text-sm leading-relaxed text-ink">{email.body}</div>

          {email.rescheduledCount > 0 && email.status === 'SCHEDULED' && (
            <p className="mt-4 text-sm text-pending">Moved to a later window by a sending limit. It will go out at the time above.</p>
          )}
          {email.error && (
            <p className="mt-4 rounded-lg bg-danger-tint px-4 py-3 text-sm text-danger">
              <span className="font-medium">Last error:</span> {email.error}
            </p>
          )}
          {email.previewUrl && (
            <a
              href={email.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-dark hover:underline"
            >
              Open in Ethereal
              <Icon name="external" size={14} />
            </a>
          )}
        </div>
      )}
    </article>
  );
}
