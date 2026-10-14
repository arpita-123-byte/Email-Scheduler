'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { usePolledQuery } from '@/hooks/usePolledQuery';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

const OAUTH_RESULT: Record<string, { kind: 'success' | 'error'; message: string }> = {
  connected: { kind: 'success', message: 'Slack connected. You will get a message when a sending limit is reached.' },
  access_denied: { kind: 'error', message: 'Slack connection cancelled.' },
  cancelled: { kind: 'error', message: 'Slack connection cancelled.' },
  not_configured: { kind: 'error', message: 'Slack is not configured on the server (SLACK_CLIENT_ID / SECRET).' },
  invalid_state: { kind: 'error', message: 'Slack connection expired. Try again.' },
  error: { kind: 'error', message: 'Slack connection failed. Check the server logs.' },
};

/** "Connect Slack" — rate-limit alerts go to the channel picked during OAuth. */
export function SlackCard() {
  const { data, loading, refetch } = usePolledQuery(() => api.slackStatus(), 'slack', 0);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();

  // Show the result of the OAuth round-trip once, then clean the URL.
  useEffect(() => {
    const result = params.get('slack');
    if (!result) return;
    const r = OAUTH_RESULT[result] ?? OAUTH_RESULT.error;
    if (r.kind === 'success') toast.success(r.message);
    else toast.error(r.message);
    void refetch();
    router.replace(window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function disconnect() {
    setBusy(true);
    try {
      await api.disconnectSlack();
      toast.info('Slack disconnected. Limit alerts are off.');
      await refetch();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
        <Icon name="bell" size={16} />
        Limit alerts
      </div>
      {loading ? (
        <div className="h-8 animate-pulse rounded-full bg-surface-sunken" />
      ) : data?.connected ? (
        <>
          <p className="mb-2 text-xs text-ink-muted">
            Posting to <span className="text-ink">{data.connection?.channelName ?? 'Slack'}</span> in {data.connection?.teamName}
          </p>
          <Button variant="ghost" size="sm" loading={busy} onClick={() => void disconnect()} className="-ml-3">
            Disconnect
          </Button>
        </>
      ) : (
        <>
          <p className="mb-2 text-xs text-ink-muted">Get a Slack message the moment a sender hits its hourly limit.</p>
          <a href={api.slackConnectUrl} className={buttonClasses('primary', 'sm', 'w-full')}>
            Connect Slack
          </a>
        </>
      )}
    </div>
  );
}
