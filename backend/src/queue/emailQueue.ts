import { Queue } from 'bullmq';
import { env } from '../config/env';
import { createRedisConnection } from '../lib/redis';

export interface SendEmailJobData {
  emailId: string;
  /** Send slot reserved in Redis for this attempt (set by the worker). */
  reservation?: { slot: number; attempt: number };
}

export const emailQueue = new Queue<SendEmailJobData>(env.QUEUE_NAME, {
  connection: createRedisConnection('queue'),
  defaultJobOptions: {
    // Transient SMTP failures get retried with backoff; the worker's DB claim
    // makes every retry idempotent.
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    // Keep history around so Bull Board can show it, but bound memory.
    removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 },
    removeOnFail: { age: 14 * 24 * 3600 },
  },
});

/**
 * Enqueue (or re-enqueue) delayed jobs for the given emails.
 *
 * The BullMQ jobId is the Email row id. BullMQ ignores `add` calls for a jobId
 * that already exists, so calling this twice for the same email — e.g. from the
 * startup reconciler after a crash — never creates a duplicate job.
 */
export async function enqueueEmails(
  emails: { id: string; scheduledAt: Date; reserved?: boolean }[],
): Promise<void> {
  const CHUNK = 500;
  const now = Date.now();
  for (let i = 0; i < emails.length; i += CHUNK) {
    const chunk = emails.slice(i, i + CHUNK);
    await emailQueue.addBulk(
      chunk.map((e) => ({
        name: 'send-email',
        // `reservation` tells the worker this time is an already-reserved slot,
        // so it sends without reserving (and counting) a second time.
        data: e.reserved
          ? { emailId: e.id, reservation: { slot: e.scheduledAt.getTime(), attempt: 0 } }
          : { emailId: e.id },
        opts: {
          jobId: e.id,
          delay: Math.max(0, e.scheduledAt.getTime() - now),
        },
      })),
    );
  }
}
