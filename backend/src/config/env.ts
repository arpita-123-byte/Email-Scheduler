import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  BACKEND_URL: z.string().url().default('http://localhost:4000'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX: z.string().default('emails'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:4000/api/auth/google/callback'),

  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_REDIRECT_URI: z.string().default('http://localhost:4000/api/slack/callback'),

  // ---- Throughput / rate limiting (all configurable, nothing hardcoded) ----
  QUEUE_NAME: z.string().default('email-send'),
  /** Run the BullMQ worker inside the API process too (handy for local dev). */
  RUN_WORKER_IN_API: bool.default('true'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  /** Minimum gap between two sends from the same sender, enforced via Redis slot reservation across all workers. */
  MIN_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().int().min(0).default(2000),
  /** Global ceiling across every sender and every worker instance. */
  MAX_EMAILS_PER_HOUR: z.coerce.number().int().min(1).default(200),
  /** Ceiling per sender identity. */
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(1).default(100),
  /** Length of a rate-limit window. 3600000 = one hour; lower it only for demos. */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(3_600_000),

  /** "ethereal" sends over SMTP. "json" skips the network (used for offline tests). */
  MAIL_TRANSPORT: z.enum(['ethereal', 'json']).default('ethereal'),

  BULL_BOARD_USER: z.string().default(''),
  BULL_BOARD_PASSWORD: z.string().default(''),
  ELASTICSEARCH_ENABLED: bool.default('true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
