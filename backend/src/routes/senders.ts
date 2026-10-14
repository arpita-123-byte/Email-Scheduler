import { Router } from 'express';
import { env } from '../config/env';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { senders as sendersTable } from '../db/schema';
import { asyncHandler } from '../middleware/errors';
import { getUsage } from '../services/rateLimiter';

const router = Router();

/** GET /api/senders — available "From" identities plus their usage in the current window. */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const senders = await db
      .select({ id: sendersTable.id, name: sendersTable.name, email: sendersTable.email })
      .from(sendersTable)
      .where(eq(sendersTable.active, true))
      .orderBy(asc(sendersTable.createdAt));
    const usage = await getUsage(senders.map((s) => s.id));
    res.json({
      senders: senders.map((s) => ({ ...s, usage: usage.senders[s.id] })),
      global: usage.global,
      window: { start: new Date(usage.window.windowStart), end: new Date(usage.window.windowEnd) },
      config: {
        minDelayBetweenEmailsMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
        maxEmailsPerHour: env.MAX_EMAILS_PER_HOUR,
        maxEmailsPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        workerConcurrency: env.WORKER_CONCURRENCY,
      },
    });
  }),
);

export default router;
