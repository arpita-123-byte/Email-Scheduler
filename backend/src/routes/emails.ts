import { Router } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { emails, senders, type EmailStatus } from '../db/schema';
import { asyncHandler, HttpError } from '../middleware/errors';
import { searchEmails } from '../services/search';

const router = Router();

const TAB_STATUSES: Record<'scheduled' | 'sent', EmailStatus[]> = {
  scheduled: ['SCHEDULED', 'SENDING'],
  sent: ['SENT', 'FAILED'],
};

const listSchema = z.object({
  tab: z.enum(['scheduled', 'sent']).default('scheduled'),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const emailColumns = {
  id: emails.id,
  toEmail: emails.toEmail,
  subject: emails.subject,
  body: emails.body,
  status: emails.status,
  scheduledAt: emails.scheduledAt,
  sentAt: emails.sentAt,
  previewUrl: emails.previewUrl,
  error: emails.error,
  rescheduledCount: emails.rescheduledCount,
  campaignId: emails.campaignId,
  updatedAt: emails.updatedAt,
  sender: { id: senders.id, name: senders.name, email: senders.email },
};

/**
 * GET /api/emails?tab=scheduled|sent&q=&page=&pageSize=
 * With `q`, ids come from Elasticsearch (full-text over recipient, subject, body);
 * if ES is unavailable we fall back to a Postgres ILIKE so the UI keeps working.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { tab, q, page, pageSize } = listSchema.parse(req.query);
    const userId = req.user!.sub;
    const statuses = TAB_STATUSES[tab];

    const filters: SQL[] = [eq(emails.userId, userId), inArray(emails.status, statuses)];
    let searchEngine: 'elasticsearch' | 'postgres' | null = null;

    if (q) {
      const ids = await searchEmails({ userId, q, statuses, limit: 500 });
      if (ids) {
        searchEngine = 'elasticsearch';
        if (ids.length === 0) {
          res.json({ items: [], total: 0, page, pageSize, searchEngine });
          return;
        }
        filters.push(inArray(emails.id, ids));
      } else {
        searchEngine = 'postgres';
        const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
        filters.push(or(ilike(emails.toEmail, like), ilike(emails.subject, like), ilike(emails.body, like))!);
      }
    }

    const where = and(...filters);
    const orderBy =
      tab === 'scheduled' ? [asc(emails.scheduledAt), asc(emails.sequence)] : [desc(emails.updatedAt)];

    const [items, [{ total }]] = await Promise.all([
      db
        .select(emailColumns)
        .from(emails)
        .innerJoin(senders, eq(emails.senderId, senders.id))
        .where(where)
        .orderBy(...orderBy)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(emails).where(where),
    ]);
    res.json({ items, total, page, pageSize, searchEngine });
  }),
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const grouped = await db
      .select({ status: emails.status, n: count() })
      .from(emails)
      .where(eq(emails.userId, req.user!.sub))
      .groupBy(emails.status);
    const counts: Record<EmailStatus, number> = { SCHEDULED: 0, SENDING: 0, SENT: 0, FAILED: 0 };
    grouped.forEach((g) => (counts[g.status] = g.n));
    res.json({ scheduled: counts.SCHEDULED + counts.SENDING, sent: counts.SENT, failed: counts.FAILED });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [email] = await db
      .select(emailColumns)
      .from(emails)
      .innerJoin(senders, eq(emails.senderId, senders.id))
      .where(and(eq(emails.id, req.params.id), eq(emails.userId, req.user!.sub)));
    if (!email) throw new HttpError(404, 'Email not found');
    res.json({ email });
  }),
);

export default router;
