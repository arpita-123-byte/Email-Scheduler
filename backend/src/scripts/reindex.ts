/** Rebuilds the Elasticsearch index from PostgreSQL (the source of truth). */
import { asc, gt } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { emails } from '../db/schema';
import { ensureIndex, indexEmails } from '../services/search';

async function main() {
  await ensureIndex();
  let lastId = '';
  let total = 0;
  for (;;) {
    const batch = await db.select().from(emails).where(gt(emails.id, lastId)).orderBy(asc(emails.id)).limit(1000);
    if (batch.length === 0) break;
    await indexEmails(batch);
    total += batch.length;
    lastId = batch[batch.length - 1].id;
  }
  console.log(`Reindexed ${total} emails`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
