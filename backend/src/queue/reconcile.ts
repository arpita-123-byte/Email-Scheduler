import { and, asc, eq, gt, inArray, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { campaigns, emails } from '../db/schema';
import { redis } from '../lib/redis';
import { reserveSendSlots } from '../services/rateLimiter';
import { applySlots } from '../services/scheduler';
import { indexEmails } from '../services/search';
import { emailQueue, enqueueEmails } from './emailQueue';

const INTERRUPTED = 'Worker was interrupted during SMTP handoff; not retried to avoid a duplicate send.';
/** Same threshold the worker uses: older than this past its slot = "late". */
const LATE_MS = 5_000;

/**
 * Runs once when a worker process starts, before it takes any job.
 *
 * A plain restart needs nothing special: delayed jobs live in Redis (AOF
 * persistence in docker-compose) and BullMQ releases them on time once a worker
 * reconnects. This function handles what a plain restart can't:
 *
 *  1. Backlog after downtime. Emails whose slot passed while the server was
 *     down are re-planned in their original order (scheduled time, then
 *     recipient order), so the backlog goes out spaced by the minimum delay and
 *     within the hourly limits, instead of as one burst.
 *  2. Lost jobs. If Redis lost data (flush, no persistence, new instance) or the
 *     API died between the DB insert and the enqueue, every email the DB still
 *     marks SCHEDULED without a job gets one again, with the same jobId.
 *     If its reserved slot is still in Redis it keeps it; otherwise it gets a
 *     fresh slot here.
 *  3. Interrupted sends. A row stuck in SENDING whose job is gone was being
 *     handed to SMTP when the process died. We cannot know whether it was
 *     accepted, so it is marked FAILED (at-most-once: never a duplicate).
 *
 * Nothing here can cause a double send: the worker re-checks the DB status
 * and claims the row atomically before sending.
 */
export async function reconcileOnStartup(): Promise<void> {
  const now = Date.now();
  const PAGE = 1000;
  let lastId = '';
  let checked = 0;
  const keepSlot: { id: string; scheduledAt: Date }[] = [];
  const replan = new Set<string>();

  // ---- find jobs that are missing or late --------------------------------------
  for (;;) {
    const batch = await db
      .select({ id: emails.id, scheduledAt: emails.scheduledAt, senderId: emails.senderId })
      .from(emails)
      .where(and(eq(emails.status, 'SCHEDULED'), gt(emails.id, lastId)))
      .orderBy(asc(emails.id))
      .limit(PAGE);
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1].id;
    checked += batch.length;

    const states = await Promise.all(batch.map((e) => emailQueue.getJobState(e.id)));
    const pipeline = redis.pipeline();
    batch.forEach((e) => pipeline.zscore(`rl:slots:sender:${e.senderId}`, e.id));
    const scores = (await pipeline.exec()) ?? [];

    batch.forEach((e, i) => {
      const missing = ['unknown', 'completed', 'failed'].includes(states[i]);
      const late = e.scheduledAt.getTime() < now - LATE_MS;
      const slotIntact = Number(scores[i]?.[1]) === e.scheduledAt.getTime();
      if (late || (missing && !slotIntact)) replan.add(e.id);
      else if (missing) keepSlot.push(e);
    });
  }

  // ---- lost jobs whose reserved slot survived: re-create with the same slot ------
  if (keepSlot.length) {
    await removeJobs(keepSlot.map((e) => e.id));
    await enqueueEmails(keepSlot.map((e) => ({ ...e, reserved: true })));
  }

  // ---- re-plan the rest in original order ---------------------------------------
  let replanned = 0;
  if (replan.size) {
    const ids = [...replan];
    const rows = [];
    for (let i = 0; i < ids.length; i += PAGE) {
      rows.push(
        ...(await db
          .select({
            id: emails.id,
            senderId: emails.senderId,
            campaignId: emails.campaignId,
            scheduledAt: emails.scheduledAt,
            sequence: emails.sequence,
            hourlyLimit: campaigns.hourlyLimit,
          })
          .from(emails)
          .innerJoin(campaigns, eq(emails.campaignId, campaigns.id))
          .where(inArray(emails.id, ids.slice(i, i + PAGE)))),
      );
    }
    rows.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || a.sequence - b.sequence);

    // Consecutive runs of the same campaign are reserved in one batch call.
    for (let i = 0; i < rows.length; ) {
      let j = i;
      while (j < rows.length && rows[j].campaignId === rows[i].campaignId) j++;
      const group = rows.slice(i, j);
      const reservations = await reserveSendSlots({
        senderId: group[0].senderId,
        campaignId: group[0].campaignId,
        campaignHourlyLimit: group[0].hourlyLimit,
        items: group.map((r) => ({ emailId: r.id, desired: r.scheduledAt.getTime() })),
      });
      await applySlots(reservations);
      await removeJobs(group.map((r) => r.id));
      await enqueueEmails(reservations.map((r) => ({ id: r.emailId, scheduledAt: new Date(r.slot), reserved: true })));
      replanned += group.length;
      i = j;
    }
    const updated = await db.select().from(emails).where(inArray(emails.id, ids.slice(0, 5000)));
    await indexEmails(updated);
  }

  // ---- interrupted sends ------------------------------------------------------------
  const stale = await db
    .select({ id: emails.id })
    .from(emails)
    .where(and(eq(emails.status, 'SENDING'), lt(emails.lockedAt, new Date(now - 5 * 60_000))));
  const orphaned: string[] = [];
  for (const e of stale) {
    const state = await emailQueue.getJobState(e.id);
    if (!['active', 'waiting', 'delayed'].includes(state)) orphaned.push(e.id);
  }
  if (orphaned.length) {
    const failedRows = await db
      .update(emails)
      .set({ status: 'FAILED', lockedAt: null, error: INTERRUPTED })
      .where(inArray(emails.id, orphaned))
      .returning();
    await indexEmails(failedRows);
  }

  console.log(
    `[reconcile] checked ${checked} scheduled emails: ${keepSlot.length} lost jobs restored, ` +
      `${replanned} late/lost emails re-planned in order, ${orphaned.length} interrupted sends marked failed`,
  );
}

/** Remove existing (non-active) jobs so the same jobId can be added again. */
async function removeJobs(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map(async (id) => {
      const job = await emailQueue.getJob(id);
      if (job) await job.remove().catch(() => undefined); // an active job (another worker) is left alone
    }),
  );
}
