/**
 * Schedules a large campaign for the "rate limiting under load" demo.
 *
 *   npm run load:test -- <userEmail> [count=1000] [hourlyLimit=100000]
 *
 * All emails are scheduled for "now" with zero delay, so they compete for the
 * same window. With the default limits (200/hour global, 100/hour per sender)
 * you will see the first batch go out at the configured MIN_DELAY spacing and
 * the rest move to the next window, in order, without being dropped.
 *
 * Tip: set RATE_LIMIT_WINDOW_MS=60000 and MAX_EMAILS_PER_HOUR_PER_SENDER=10
 * in .env to watch several windows roll over during a short demo.
 * Recipients use the reserved example.com domain (Ethereal never delivers anyway).
 */
import { asc, eq } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { senders, users } from '../db/schema';
import { scheduleCampaign } from '../services/scheduler';
import { emailQueue } from '../queue/emailQueue';

async function main() {
  const userEmail = process.argv[2];
  const count = Number(process.argv[3] ?? 1000);
  const hourlyLimit = Number(process.argv[4] ?? 100_000);
  if (!userEmail) throw new Error('Usage: npm run load:test -- <userEmail> [count] [hourlyLimit]');

  const user = await db.query.users.findFirst({ where: eq(users.email, userEmail) });
  if (!user) throw new Error(`No user ${userEmail}. Log in through the frontend once first.`);
  const sender = await db.query.senders.findFirst({
    where: eq(senders.active, true),
    orderBy: asc(senders.createdAt),
  });
  if (!sender) throw new Error('No senders. Run npm run senders:create first.');

  const recipients = Array.from({ length: count }, (_, i) => `lead${i + 1}@example.com`);
  const started = Date.now();
  const result = await scheduleCampaign({
    userId: user.id,
    senderId: sender.id,
    subject: `Load test ${new Date().toISOString()}`,
    body: 'This email was scheduled by the load test script.',
    recipients,
    startAt: new Date(),
    delayMs: 0,
    hourlyLimit,
  });
  console.log(`Scheduled ${result.scheduled} emails from ${sender.email} in ${Date.now() - started}ms`);
  console.log('Watch progress in Bull Board (/admin/queues) and the dashboard.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await emailQueue.close();
    await pool.end();
    process.exit();
  });
