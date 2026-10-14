import type { Worker } from 'bullmq';
import { pool } from './db/client';
import { createEmailWorker } from './queue/emailWorker';
import { reconcileOnStartup } from './queue/reconcile';
import { ensureIndex } from './services/search';

/** Starts a worker plus the startup reconciler. Returns a graceful shutdown fn. */
export async function startWorker(): Promise<() => Promise<void>> {
  await ensureIndex();
  await reconcileOnStartup();
  const worker: Worker = createEmailWorker();
  return async () => {
    // close() waits for in-flight jobs to finish, so a Ctrl+C never leaves an
    // email half-sent unless the process is killed hard.
    await worker.close();
  };
}

if (require.main === module) {
  startWorker()
    .then((stop) => {
      const shutdown = async (signal: string) => {
        console.log(`[worker] ${signal} received, finishing in-flight jobs...`);
        await stop();
        await pool.end();
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));
    })
    .catch((err) => {
      console.error('[worker] failed to start', err);
      process.exit(1);
    });
}
