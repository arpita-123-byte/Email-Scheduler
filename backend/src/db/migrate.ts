/** Applies the SQL migrations in ./drizzle. Run with `npm run db:migrate`. */
import path from 'path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';

async function main() {
  await migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'drizzle') });
  console.log('Migrations applied');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
