import { DelayedError, Job, Worker } from 'bullmq';
import { env } from '../config/env';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { emails, type Email } from '../db/schema';
import { createRedisConnection } from '../lib/redis';
import { sendMail } from '../services/mailer';
import { reserveSendSlots } from '../services/rateLimiter';
import { indexEmail } from '../services/search';
import { notifyRateLimitHit } from '../services/slack';
import type { SendEmailJobData } from './emailQueue';

/** A job may fire this much before its reserved slot and still count as on time. */
const SLOT_TOLERANCE_MS = 25;
/**
 * A job that fires this much AFTER its slot (e.g. the server was down) gets a
 * fresh slot instead, so a backlog after a restart is still spaced by the
 * minimum delay rather than sent in one burst.
 */
const LATE_TOLERANCE_MS = 5_000;

type ProcessResult = { outcome: 'sent' | 'skipped' | 'failed'; reason?: string; previewUrl?: string | null };

async function updateEmail(emailId: string, data: Partial<Email>): Promise<Email> {
  const [row] = await db.update(emails).set(data).where(eq(emails.id, emailId)).returning();
  await indexEmail(row);
  return row;
}

async function failPermanently(emailId: string, reason: string): Promise<void> {
  await updateEmail(emailId, { status: 'FAILED', error: reason, lockedAt: null });
}

async function processEmail(job: Job<SendEmailJobData>, token: string | undefined): Promise<ProcessResult> {
  const { emailId } = job.data;
  const email = await db.query.emails.findFirst({
    where: eq(emails.id, emailId),
    with: { sender: true, campaign: { columns: { hourlyLimit: true } } },
  });

  // ---- 1. Idempotency guards ------------------------------------------------
  if (!email) return { outcome: 'skipped', reason: 'email row no longer exists' };
  if (email.status === 'SENT' || email.status === 'FAILED') {
    // Already handled (e.g. a duplicate delivery of the job after a crash).
    return { outcome: 'skipped', reason: `already ${email.status}` };
  }
  if (email.status === 'SENDING') {
    // A previous worker claimed this email and died before recording the result.
    // We cannot know if the SMTP server accepted it, and the brief forbids
    // duplicates, so we choose at-most-once: mark it failed instead of re-sending.
    await failPermanently(emailId, 'Worker was interrupted during SMTP handoff; not retried to avoid a duplicate send.');
    return { outcome: 'failed', reason: 'interrupted mid-send' };
  }

  // Safety net: if the DB says this email is due later than the job fired
  // (e.g. a re-enqueue raced a reschedule), wait until the DB time.
  if (email.scheduledAt.getTime() > Date.now() + 1000 && token) {
    await job.moveToDelayed(email.scheduledAt.getTime(), token);
    throw new DelayedError();
  }

  // ---- 2. Rate limits + minimum delay -----------------------------------------
  // Normally the slot was reserved when the campaign was scheduled, and the job
  // fires exactly at it. Jobs without a valid reservation (a retry after an
  // SMTP failure, or a job re-created by the startup reconciler) reserve one
  // now; if it is in the future the job is parked until then.
  const reservation = job.data.reservation;
  const holdsValidReservation =
    reservation !== undefined &&
    reservation.attempt === job.attemptsMade &&
    Date.now() >= reservation.slot - SLOT_TOLERANCE_MS &&
    Date.now() <= reservation.slot + LATE_TOLERANCE_MS;

  if (!holdsValidReservation) {
    const [{ slot, blockedBy }] = await reserveSendSlots({
      senderId: email.senderId,
      campaignId: email.campaignId,
      campaignHourlyLimit: email.campaign.hourlyLimit,
      items: [{ emailId, desired: Date.now() }],
    });

    if (blockedBy) {
      const scopeId =
        blockedBy.scope === 'sender' ? email.senderId : blockedBy.scope === 'campaign' ? email.campaignId : 'all';
      const scopeName =
        blockedBy.scope === 'sender'
          ? `${email.sender.name} <${email.sender.email}>`
          : blockedBy.scope === 'campaign'
            ? `"${email.subject}"`
            : 'All senders';
      await notifyRateLimitHit({
        userId: email.userId,
        scope: blockedBy.scope,
        scopeId,
        scopeName,
        limit: blockedBy.limit,
        window: blockedBy.window,
        resumesAt: new Date(slot),
      });
    }

    if (slot > Date.now() + SLOT_TOLERANCE_MS) {
      if (!token) throw new Error('Missing job token, cannot delay job');
      await updateEmail(emailId, {
        scheduledAt: new Date(slot),
        ...(blockedBy ? { rescheduledCount: email.rescheduledCount + 1 } : {}),
      });
      await job.updateData({ ...job.data, reservation: { slot, attempt: job.attemptsMade } });
      await job.moveToDelayed(slot, token);
      throw new DelayedError();
    }
  }

  // ---- 3. Atomic claim: SCHEDULED -> SENDING ---------------------------------
  // Only one worker can win this conditional update, even if the same job were
  // somehow delivered to two workers at once.
  const claimed = await db
    .update(emails)
    .set({ status: 'SENDING', lockedAt: new Date(), attempts: sql`${emails.attempts} + 1` })
    .where(and(eq(emails.id, emailId), eq(emails.status, 'SCHEDULED')))
    .returning({ id: emails.id });
  if (claimed.length === 0) return { outcome: 'skipped', reason: 'claimed by another worker' };

  // ---- 4. Send ---------------------------------------------------------------
  try {
    const result = await sendMail({
      sender: email.sender,
      emailId,
      to: email.toEmail,
      subject: email.subject,
      body: email.body,
    });
    await updateEmail(emailId, {
      status: 'SENT',
      sentAt: new Date(),
      messageId: result.messageId,
      previewUrl: result.previewUrl,
      error: null,
      lockedAt: null,
    });
    return { outcome: 'sent', previewUrl: result.previewUrl };
  } catch (err) {
    // The SMTP server rejected / could not be reached. Put the row back so the
    // BullMQ retry can claim it again, or fail it on the last attempt.
    const message = (err as Error).message;
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await updateEmail(emailId, { status: isLastAttempt ? 'FAILED' : 'SCHEDULED', error: message, lockedAt: null });
    throw err;
  }
}

export function createEmailWorker(): Worker<SendEmailJobData> {
  const worker: Worker<SendEmailJobData> = new Worker<SendEmailJobData>(
    env.QUEUE_NAME,
    (job, token) => processEmail(job, token),
    {
      connection: createRedisConnection('worker'),
      concurrency: env.WORKER_CONCURRENCY,
      // If a worker dies, its active jobs are detected as stalled and handed
      // back; the DB status check above makes that safe.
      stalledInterval: 30_000,
      maxStalledCount: 1,
    },
  );

  worker.on('completed', (job, result: ProcessResult) => {
    console.log(`[worker] ${job.id} -> ${result.outcome}${result.reason ? ` (${result.reason})` : ''}`);
  });
  worker.on('failed', (job, err) => {
    console.warn(`[worker] ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`);
  });
  worker.on('error', (err) => console.error('[worker] error', err.message));

  console.log(
    `[worker] started: concurrency=${env.WORKER_CONCURRENCY}, min gap per sender=${env.MIN_DELAY_BETWEEN_EMAILS_MS}ms, ` +
      `hourly global=${env.MAX_EMAILS_PER_HOUR} per-sender=${env.MAX_EMAILS_PER_HOUR_PER_SENDER}`,
  );
  return worker;
}
