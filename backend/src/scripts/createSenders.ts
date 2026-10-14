/**
 * Creates N Ethereal test accounts and stores them as senders.
 *   npm run senders:create          -> 3 senders
 *   npm run senders:create -- 5     -> 5 senders
 *
 * Ethereal is a fake SMTP service: mail is accepted but never delivered, and
 * every message gets a preview URL you can open in the browser.
 */
import nodemailer from 'nodemailer';
import { db, pool } from '../db/client';
import { senders } from '../db/schema';

const NAMES = ['Outbox Sales', 'Outbox Growth', 'Outbox Support', 'Outbox Founders', 'Outbox Partnerships'];

async function main() {
  const targetCount = Number(process.argv[2] ?? 3);
  let created = 0;
  let attempts = 0;
  while (created < targetCount && attempts < 15) {
    attempts++;
    const account = await nodemailer.createTestAccount();
    const existing = await db.query.senders.findFirst({
      where: (s, { eq }) => eq(s.email, account.user),
    });
    if (existing) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    const [sender] = await db
      .insert(senders)
      .values({
        name: NAMES[created % NAMES.length],
        email: account.user,
        smtpHost: account.smtp.host,
        smtpPort: account.smtp.port,
        smtpUser: account.user,
        smtpPass: account.pass,
      })
      .returning();
    created++;
    console.log(`Created sender ${sender.name} <${sender.email}>`);
    console.log(`  Ethereal inbox login: https://ethereal.email/login  user=${account.user}  pass=${account.pass}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
