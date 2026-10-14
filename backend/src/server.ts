import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { env } from './config/env';
import { sql } from 'drizzle-orm';
import { db, pool } from './db/client';
import { redis } from './lib/redis';
import { emailQueue } from './queue/emailQueue';
import { requireAuth } from './middleware/auth';
import { errorHandler } from './middleware/errors';
import authRoutes from './routes/auth';
import campaignRoutes from './routes/campaigns';
import emailRoutes from './routes/emails';
import senderRoutes from './routes/senders';
import slackRoutes from './routes/slack';
import { ensureIndex } from './services/search';
import { startWorker } from './worker';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// ---- Live BullMQ dashboard (Bull Board) at /admin/queues ---------------------
const boardAdapter = new ExpressAdapter();
boardAdapter.setBasePath('/admin/queues');
createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter: boardAdapter });

function boardAuth(req: Request, res: Response, next: NextFunction): void {
  if (!env.BULL_BOARD_USER) return next(); // open in local dev when no credentials are configured
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  const [user, pass] = Buffer.from(encoded ?? '', 'base64').toString().split(':');
  if (scheme === 'Basic' && user === env.BULL_BOARD_USER && pass === env.BULL_BOARD_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="Bull Board"').status(401).send('Authentication required');
}
app.use('/admin/queues', boardAuth, boardAdapter.getRouter());

// ---- API -------------------------------------------------------------------
app.get('/health', async (_req, res) => {
  const [database, cache] = await Promise.allSettled([db.execute(sql`select 1`), redis.ping()]);
  res.json({ db: database.status === 'fulfilled', redis: cache.status === 'fulfilled' });
});
app.use('/api/auth', authRoutes);
app.use('/api/slack', slackRoutes);
app.use('/api/campaigns', requireAuth, campaignRoutes);
app.use('/api/emails', requireAuth, emailRoutes);
app.use('/api/senders', requireAuth, senderRoutes);
app.use(errorHandler);

async function main() {
  await ensureIndex();
  let stopWorker: (() => Promise<void>) | null = null;
  if (env.RUN_WORKER_IN_API) stopWorker = await startWorker();

  const server = app.listen(env.PORT, () => {
    console.log(`[api] listening on ${env.BACKEND_URL}`);
    console.log(`[api] Bull Board: ${env.BACKEND_URL}/admin/queues`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[api] ${signal} received, shutting down gracefully...`);
    server.close();
    if (stopWorker) await stopWorker();
    await emailQueue.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[api] failed to start', err);
  process.exit(1);
});
