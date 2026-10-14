import crypto from 'crypto';

/**
 * Time-ordered, URL-safe id (e.g. "m3k9x2a1-4f8c2b9e1d7a").
 * Used as both the DB primary key and the BullMQ jobId, so it must not contain ':'.
 */
export function createId(): string {
  return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
}
