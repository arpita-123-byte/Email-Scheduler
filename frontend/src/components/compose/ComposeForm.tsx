'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDateTime, plural, toLocalInputValue } from '@/lib/format';
import { usePolledQuery } from '@/hooks/usePolledQuery';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, ButtonLink } from '@/components/ui/Button';
import { FieldRow, Input, NumberBox, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { LeadsUpload } from './LeadsUpload';
import { StartTimePicker } from './StartTimePicker';

interface FormState {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startAt: string; // datetime-local
  delaySeconds: string;
  hourlyLimit: string;
}

type Errors = Partial<Record<keyof FormState, string>>;

function validate(f: FormState): Errors {
  const e: Errors = {};
  if (!f.senderId) e.senderId = 'Choose who the email is from.';
  if (f.recipients.length === 0) e.recipients = 'Upload a list with at least one email address.';
  if (!f.subject.trim()) e.subject = 'Add a subject.';
  if (!f.body.trim()) e.body = 'Write the email body.';
  if (!f.startAt) e.startAt = 'Pick when sending should start.';
  const delay = Number(f.delaySeconds);
  if (!Number.isFinite(delay) || delay < 0 || delay > 86_400) e.delaySeconds = 'Delay must be between 0 and 86400 seconds.';
  const limit = Number(f.hourlyLimit);
  if (!Number.isInteger(limit) || limit < 1) e.hourlyLimit = 'Hourly limit must be a whole number of at least 1.';
  return e;
}

export function ComposeForm() {
  const router = useRouter();
  const toast = useToast();
  const { data: senderData, loading: sendersLoading, error: sendersError } = usePolledQuery(() => api.senders(), 'senders', 0);

  const [form, setForm] = useState<FormState>({
    senderId: '',
    subject: '',
    body: '',
    recipients: [],
    startAt: toLocalInputValue(new Date(Date.now() + 60_000)),
    delaySeconds: '2',
    hourlyLimit: '50',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const senders = senderData?.senders ?? [];
  const senderId = form.senderId || senders[0]?.id || '';
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  // Rough finish estimate so the user sees what the hourly limit means before scheduling.
  const estimate = useMemo(() => {
    const n = form.recipients.length;
    const limit = Number(form.hourlyLimit);
    const delay = Number(form.delaySeconds);
    if (!n || !limit || !form.startAt || Number.isNaN(delay)) return null;
    const hours = Math.ceil(n / limit) - 1;
    const start = new Date(form.startAt).getTime();
    const end = start + Math.max((n - 1) * delay * 1000, hours * 3_600_000);
    return { end: new Date(end).toISOString(), hoursSpan: hours };
  }, [form.recipients.length, form.hourlyLimit, form.delaySeconds, form.startAt]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const full = { ...form, senderId };
    const found = validate(full);
    setErrors(found);
    if (Object.keys(found).length) return;

    setSubmitting(true);
    try {
      const res = await api.schedule({
        senderId,
        subject: full.subject.trim(),
        body: full.body,
        recipients: full.recipients,
        startAt: new Date(full.startAt).toISOString(),
        delaySeconds: Number(full.delaySeconds),
        hourlyLimit: Number(full.hourlyLimit),
      });
      const pushed = res.pushedToLaterWindows
        ? ` ${plural(res.pushedToLaterWindows, 'email')} moved to later hours by sending limits.`
        : '';
      toast.success(`Scheduled ${plural(res.scheduled, 'email')}. First send ${formatDateTime(res.firstSendAt)}.${pushed}`);
      router.push('/dashboard/scheduled');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto w-full max-w-3xl">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <ButtonLink href="/dashboard/scheduled" variant="ghost" size="sm" className="-ml-2 !px-2">
          <Icon name="back" />
          <span className="sr-only">Back to scheduled emails</span>
        </ButtonLink>
        <h1 className="text-lg font-semibold text-ink">Compose new email</h1>
      </div>

      <div className="px-5">
        <FieldRow label="From" htmlFor="from" error={errors.senderId ?? sendersError ?? undefined}>
          {sendersLoading ? (
            <div className="h-9 animate-pulse rounded-md bg-surface-sunken" />
          ) : senders.length === 0 ? (
            <p className="px-2 py-2 text-sm text-danger">No senders yet. Run npm run senders:create in the backend.</p>
          ) : (
            <Select id="from" value={senderId} onChange={(e) => set('senderId', e.target.value)}>
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} &lt;{s.email}&gt; · {s.usage.used}/{s.usage.limit} this hour
                </option>
              ))}
            </Select>
          )}
        </FieldRow>

        <FieldRow label="To" error={errors.recipients}>
          <LeadsUpload emails={form.recipients} onChange={(v) => set('recipients', v)} />
        </FieldRow>

        <FieldRow label="Subject" htmlFor="subject" error={errors.subject}>
          <Input id="subject" value={form.subject} onChange={(e) => set('subject', e.target.value)} placeholder="Quick question about your outbound" maxLength={300} />
        </FieldRow>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-line py-3">
          <NumberBox
            label="Delay between emails"
            suffix="sec"
            min={0}
            step={1}
            value={form.delaySeconds}
            onChange={(e) => set('delaySeconds', e.target.value)}
          />
          <NumberBox
            label="Hourly limit"
            suffix="/hr"
            min={1}
            step={1}
            value={form.hourlyLimit}
            onChange={(e) => set('hourlyLimit', e.target.value)}
          />
          {(errors.delaySeconds || errors.hourlyLimit) && (
            <p className="w-full text-xs text-danger">{errors.delaySeconds ?? errors.hourlyLimit}</p>
          )}
        </div>

        <FieldRow
          label="Start time"
          htmlFor="start"
          error={errors.startAt}
          hint={
            estimate && (
              <>
                Last email around {formatDateTime(estimate.end)}
                {estimate.hoursSpan > 0 && ` (spread over ${plural(estimate.hoursSpan + 1, 'hour')} by your hourly limit)`}.
                Server limits can push it later.
              </>
            )
          }
        >
          <StartTimePicker id="start" value={form.startAt} onChange={(v) => set('startAt', v)} />
        </FieldRow>

        <div className="py-3">
          <label htmlFor="body" className="sr-only">
            Body
          </label>
          <Textarea
            id="body"
            value={form.body}
            onChange={(e) => set('body', e.target.value)}
            placeholder="Type your reply..."
            rows={11}
            className="border-line bg-surface-sunken/60 px-3 py-3"
          />
          {errors.body && <p className="mt-1 text-xs text-danger">{errors.body}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 pb-8 pt-2">
          {senderData && (
            <p className="mr-auto text-xs text-ink-muted">
              Server limits: {senderData.config.maxEmailsPerHourPerSender}/hr per sender, {senderData.config.maxEmailsPerHour}/hr total, min{' '}
              {senderData.config.minDelayBetweenEmailsMs / 1000}s between sends.
            </p>
          )}
          <Button type="submit" size="lg" loading={submitting}>
            Schedule
          </Button>
        </div>
      </div>
    </form>
  );
}
