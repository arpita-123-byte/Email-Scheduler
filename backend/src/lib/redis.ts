import IORedis from 'ioredis';
import { env } from '../config/env';

/**
 * BullMQ needs `maxRetriesPerRequest: null` on connections used by workers
 * (blocking commands). We create separate connections per role so a blocked
 * worker connection never stalls rate-limit counters or API calls.
 */
export function createRedisConnection(name: string): IORedis {
  const conn = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName: name,
  });
  conn.on('error', (err) => console.error(`[redis:${name}]`, err.message));
  return conn;
}

/** Shared connection for counters, locks and other short commands. */
export const redis = createRedisConnection('shared');
