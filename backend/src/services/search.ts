import { Client } from '@elastic/elasticsearch';
import type { Email } from '../db/schema';
import { env } from '../config/env';

/**
 * Elasticsearch is a secondary index used only for full-text search.
 * PostgreSQL stays the source of truth: if ES is down, scheduling and sending
 * keep working and `npm run es:reindex` rebuilds the index from the DB.
 */
export const es = new Client({ node: env.ELASTICSEARCH_URL });
const INDEX = env.ELASTICSEARCH_INDEX;

export interface EmailSearchDoc {
  id: string;
  userId: string;
  campaignId: string;
  toEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
}

function toDoc(e: Email): EmailSearchDoc {
  return {
    id: e.id,
    userId: e.userId,
    campaignId: e.campaignId,
    toEmail: e.toEmail,
    subject: e.subject,
    body: e.body,
    status: e.status,
    scheduledAt: e.scheduledAt.toISOString(),
    sentAt: e.sentAt ? e.sentAt.toISOString() : null,
  };
}

let ready = false;

export async function ensureIndex(): Promise<void> {
  if (!env.ELASTICSEARCH_ENABLED) return;
  try {
    const exists = await es.indices.exists({ index: INDEX });
    if (!exists) {
      await es.indices.create({
        index: INDEX,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            userId: { type: 'keyword' },
            campaignId: { type: 'keyword' },
            toEmail: {
              type: 'text',
              analyzer: 'simple',
              fields: { keyword: { type: 'keyword' } },
            },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
          },
        },
      });
      console.log(`[es] created index "${INDEX}"`);
    }
    ready = true;
  } catch (err) {
    console.warn('[es] unavailable, search disabled until it comes back:', (err as Error).message);
  }
}

export async function indexEmails(emails: Email[]): Promise<void> {
  if (!env.ELASTICSEARCH_ENABLED || emails.length === 0) return;
  try {
    const operations = emails.flatMap((e) => [{ index: { _index: INDEX, _id: e.id } }, toDoc(e)]);
    const res = await es.bulk({ operations, refresh: false });
    if (res.errors) console.warn('[es] some documents failed to index');
  } catch (err) {
    console.warn('[es] bulk index failed:', (err as Error).message);
  }
}

export async function indexEmail(email: Email): Promise<void> {
  if (!env.ELASTICSEARCH_ENABLED) return;
  try {
    await es.index({ index: INDEX, id: email.id, document: toDoc(email) });
  } catch (err) {
    console.warn('[es] index failed:', (err as Error).message);
  }
}

export async function searchEmails(params: {
  userId: string;
  q: string;
  statuses?: string[];
  limit?: number;
}): Promise<string[] | null> {
  if (!env.ELASTICSEARCH_ENABLED) return null;
  if (!ready) await ensureIndex();
  try {
    const res = await es.search<EmailSearchDoc>({
      index: INDEX,
      size: params.limit ?? 50,
      query: {
        bool: {
          filter: [
            { term: { userId: params.userId } },
            ...(params.statuses?.length ? [{ terms: { status: params.statuses } }] : []),
          ],
          must: [
            {
              multi_match: {
                query: params.q,
                fields: ['toEmail^3', 'subject^2', 'body'],
                type: 'best_fields',
                fuzziness: 'AUTO',
              },
            },
          ],
        },
      },
    });
    return res.hits.hits.map((h) => h._id as string);
  } catch (err) {
    console.warn('[es] search failed:', (err as Error).message);
    return null;
  }
}
