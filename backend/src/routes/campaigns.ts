import { Router } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { campaigns as campaignsTable } from '../db/schema';
import { asyncHandler } from '../middleware/errors';
import { scheduleCampaign } from '../services/scheduler';

const router = Router();

const createSchema = z.object({
  senderId: z.string().min(1),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(50_000),
  recipients: z.array(z.string()).min(1).max(10_000),
  startAt: z.coerce.date(),
  delaySeconds: z.coerce.number().min(0).max(86_400),
  hourlyLimit: z.coerce.number().int().min(1).max(100_000),
});

/** POST /api/campaigns — the "Schedule" button in Compose. */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const result = await scheduleCampaign({
      userId: req.user!.sub,
      senderId: input.senderId,
      subject: input.subject,
      body: input.body,
      recipients: input.recipients,
      startAt: input.startAt,
      delayMs: Math.round(input.delaySeconds * 1000),
      hourlyLimit: input.hourlyLimit,
    });
    res.status(201).json(result);
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const campaigns = await db.query.campaigns.findMany({
      where: eq(campaignsTable.userId, req.user!.sub),
      orderBy: desc(campaignsTable.createdAt),
      limit: 50,
      with: { sender: { columns: { name: true, email: true } } },
    });
    res.json({ campaigns });
  }),
);

export default router;
