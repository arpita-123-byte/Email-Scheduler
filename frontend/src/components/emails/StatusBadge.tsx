import type { EmailStatus } from '@/lib/types';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/Icon';

const styles: Record<EmailStatus, { label: string; className: string }> = {
  SCHEDULED: { label: 'Scheduled', className: 'bg-pending-tint text-pending' },
  SENDING: { label: 'Sending', className: 'bg-pending-tint text-pending' },
  SENT: { label: 'Sent', className: 'bg-brand-tint text-brand-dark' },
  FAILED: { label: 'Failed', className: 'bg-danger-tint text-danger' },
};

export function StatusBadge({ status, rescheduled = 0 }: { status: EmailStatus; rescheduled?: number }) {
  const s = styles[status];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium', s.className)}>
      {status === 'SCHEDULED' && <Icon name="clock" size={13} />}
      {status === 'SENDING' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {s.label}
      {status === 'SCHEDULED' && rescheduled > 0 && (
        <span title="Moved to a later window by a rate limit" className="opacity-70">
          · delayed
        </span>
      )}
    </span>
  );
}
