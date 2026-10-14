import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { campaigns, emails, senders, type NewEmail } from '../db/schema';
import { HttpError } from '../middleware/errors';
import { enqueueEmails } from '../queue/emailQueue';
import { reserveSendSlots, type Reservation } from './rateLimiter';
import { indexEmails } from './search';
import { notifyRateLimitHit } from './slack';

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function normalizeRecipients(raw: string[]): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const r of raw) {
    const e = r.trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL_RE.test(e)) {
      invalid.push(r);
      continue;
    }
    if (seen.has(e)) continue;
    seen.add(e);
    valid.push(e);
  }
  return { valid, invalid };
}

/**
 * Earliest time recipient i may be sent: campaign start + i x the campaign's
 * "delay between emails". The actual slot can be later: reserveSendSlots()
 * pushes it out to respect the per-sender gap and every hourly limit.
 */
export function desiredSendTime(i: number, startAt: number, delayMs: number): number {
  return startAt + i * delayMs;
}

/** Bulk-update scheduled_at for reserved slots (one statement per 500 rows). */
export async function applySlots(reservations: Reservation[]): Promise<void> {
  for (let i = 0; i < reservations.length; i += 500) {
    const chunk = reservations.slice(i, i + 500);
    const values = sql.join(
      chunk.map(
        (r) => sql`(${r.emailId}, ${new Date(r.slot).toISOString()}::timestamptz, ${r.blockedBy ? 1 : 0}::int)`,
      ),
      sql`, `,
    );
    // `pushed` marks emails that a full window moved later, so the UI can say why.
    await db.execute(
      sql`update emails set scheduled_at = v.slot, rescheduled_count = rescheduled_count + v.pushed, updated_at = now()
          from (values ${values}) as v(id, slot, pushed) where emails.id = v.id`,
    );
  }
}

/** One Slack message per limit that pushed emails into a later window. */
async function notifyBlocked(
  ctx: { userId: string; senderId: string; senderLabel: string; campaignId: string; subject: string },
  reservations: Reservation[],
) {
  const firstPerScope = new Map<string, Reservation>();
  for (const r of reservations) {
    if (r.blockedBy && !firstPerScope.has(r.blockedBy.scope)) firstPerScope.set(r.blockedBy.scope, r);
  }
  for (const r of firstPerScope.values()) {
    const b = r.blockedBy!;
    await notifyRateLimitHit({
      userId: ctx.userId,
      scope: b.scope,
      scopeId: b.scope === 'sender' ? ctx.senderId : b.scope === 'campaign' ? ctx.campaignId : 'all',
      scopeName:
        b.scope === 'sender' ? ctx.senderLabel : b.scope === 'campaign' ? `"${ctx.subject}"` : 'All senders',
      limit: b.limit,
      window: b.window,
      resumesAt: new Date(r.slot),
    });
  }
}

export interface ScheduleCampaignInput {
  userId: string;
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startAt: Date;
  delayMs: number;
  hourlyLimit: number;
}

export async function scheduleCampaign(input: ScheduleCampaignInput) {
  const sender = await db.query.senders.findFirst({
    where: and(eq(senders.id, input.senderId), eq(senders.active, true)),
  });
  if (!sender) throw new HttpError(400, 'Unknown or inactive sender');

  const { valid, invalid } = normalizeRecipients(input.recipients);
  if (valid.length === 0) throw new HttpError(400, 'No valid email addresses found');

  // Never schedule in the past; "now" is the earliest possible start.
  const startAt = Math.max(input.startAt.getTime(), Date.now());

  // 1) Persist first. The DB is the source of truth: if the process dies right
  //    after this transaction, the startup reconciler enqueues these rows.
  const { campaign, rows } = await db.transaction(async (tx) => {
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        userId: input.userId,
        senderId: sender.id,
        subject: input.subject,
        body: input.body,
        startAt: new Date(startAt),
        delayMs: input.delayMs,
        hourlyLimit: input.hourlyLimit,
        total: valid.length,
      })
      .returning();

    const values: NewEmail[] = valid.map((to, i) => ({
      campaignId: campaign.id,
      userId: input.userId,
      senderId: sender.id,
      toEmail: to,
      subject: input.subject,
      body: input.body,
      sequence: i,
      scheduledAt: new Date(desiredSendTime(i, startAt, input.delayMs)),
    }));
    // Chunked so a 10k-recipient campaign stays under Postgres' parameter limit.
    for (let i = 0; i < values.length; i += 1000) {
      await tx.insert(emails).values(values.slice(i, i + 1000));
    }
    const rows = await tx.select().from(emails).where(eq(emails.campaignId, campaign.id)).orderBy(asc(emails.sequence));
    return { campaign, rows };
  });

  // 2) Reserve a concrete send slot for every email, in recipient order
  //    (rate limits + per-sender gap, atomically in Redis).
  const reservations = await reserveSendSlots({
    senderId: sender.id,
    campaignId: campaign.id,
    campaignHourlyLimit: input.hourlyLimit,
    items: rows.map((r) => ({ emailId: r.id, desired: r.scheduledAt.getTime() })),
  });
  await applySlots(reservations);
  rows.forEach((r, i) => (r.scheduledAt = new Date(reservations[i].slot)));

  // 3) One delayed BullMQ job per email, jobId = email id (idempotent).
  await enqueueEmails(rows.map((r) => ({ id: r.id, scheduledAt: r.scheduledAt, reserved: true })));

  // 4) Make them searchable, and tell Slack if a limit pushed emails out.
  //    Neither can block scheduling.
  await indexEmails(rows);
  await notifyBlocked(
    {
      userId: input.userId,
      senderId: sender.id,
      senderLabel: `${sender.name} <${sender.email}>`,
      campaignId: campaign.id,
      subject: input.subject,
    },
    reservations,
  );

  const pushed = reservations.filter((r) => r.blockedBy).length;
  return {
    campaign,
    scheduled: rows.length,
    invalid,
    pushedToLaterWindows: pushed,
    firstSendAt: rows[0]?.scheduledAt ?? null,
    lastSendAt: rows[rows.length - 1]?.scheduledAt ?? null,
  };
}
