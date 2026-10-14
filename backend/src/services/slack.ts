import { env } from '../config/env';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { slackConnections } from '../db/schema';
import { redis } from '../lib/redis';
import type { LimitScope, WindowInfo } from './rateLimiter';

export const SLACK_SCOPES = ['incoming-webhook', 'chat:write'];

export function slackConfigured(): boolean {
  return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
}

export function buildSlackAuthorizeUrl(state: string): string {
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', env.SLACK_CLIENT_ID);
  url.searchParams.set('scope', SLACK_SCOPES.join(','));
  url.searchParams.set('redirect_uri', env.SLACK_REDIRECT_URI);
  url.searchParams.set('state', state);
  return url.toString();
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { id: string; name: string };
  incoming_webhook?: { channel: string; channel_id: string; url: string };
}

/** Exchange the OAuth code and store (or replace) the user's Slack connection. */
export async function completeSlackOAuth(userId: string, code: string): Promise<void> {
  const body = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    client_secret: env.SLACK_CLIENT_SECRET,
    code,
    redirect_uri: env.SLACK_REDIRECT_URI,
  });
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json()) as SlackOAuthResponse;
  if (!data.ok || !data.incoming_webhook || !data.team || !data.access_token) {
    throw new Error(`Slack OAuth failed: ${data.error ?? 'missing incoming_webhook in response'}`);
  }

  const fields = {
    teamId: data.team.id,
    teamName: data.team.name,
    channelId: data.incoming_webhook.channel_id,
    channelName: data.incoming_webhook.channel,
    webhookUrl: data.incoming_webhook.url,
    accessToken: data.access_token,
  };
  await db
    .insert(slackConnections)
    .values({ userId, ...fields })
    .onConflictDoUpdate({ target: slackConnections.userId, set: { ...fields, updatedAt: new Date() } });

  await postToWebhook(
    fields.webhookUrl,
    ':white_check_mark: *Outbox Scheduler connected.* You will be notified here when a sender hits its hourly limit.',
  );
}

export async function disconnectSlack(userId: string): Promise<void> {
  await db.delete(slackConnections).where(eq(slackConnections.userId, userId));
}

async function postToWebhook(url: string, text: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}: ${await res.text()}`);
}

const SCOPE_LABEL: Record<LimitScope, string> = {
  global: 'Global hourly limit',
  sender: 'Sender hourly limit',
  campaign: 'Campaign hourly limit',
};

/**
 * Notify the owner of the email that a limit was reached.
 *
 * - Looked up from the DB on every call, so connecting / disconnecting Slack
 *   takes effect immediately with no restart or redeploy.
 * - If the user has no Slack connection we silently skip (no crash).
 * - At most one message per (user, scope, scope id, window): a SET NX key in
 *   Redis guards it, so 900 rescheduled jobs produce one message, not 900.
 * - Never throws: a Slack outage must not break email sending.
 */
export async function notifyRateLimitHit(params: {
  userId: string;
  scope: LimitScope;
  scopeId: string;
  scopeName: string;
  limit: number;
  window: WindowInfo;
  resumesAt: Date;
}): Promise<void> {
  try {
    const conn = await db.query.slackConnections.findFirst({ where: eq(slackConnections.userId, params.userId) });
    if (!conn) return;

    const dedupeKey = `slack:notified:${params.userId}:${params.scope}:${params.scopeId}:${params.window.window}`;
    const first = await redis.set(dedupeKey, '1', 'PX', env.RATE_LIMIT_WINDOW_MS * 2, 'NX');
    if (first !== 'OK') return;

    const text = [
      `:warning: *${SCOPE_LABEL[params.scope]} reached*`,
      `• ${params.scope === 'global' ? 'Scope' : params.scope === 'sender' ? 'Sender' : 'Campaign'}: *${params.scopeName}*`,
      `• Limit: *${params.limit}* emails / window`,
      `• Window: ${new Date(params.window.windowStart).toISOString()} – ${new Date(params.window.windowEnd).toISOString()}`,
      `• Remaining emails were *not dropped*; they are rescheduled to start at ${params.resumesAt.toISOString()}.`,
    ].join('\n');

    await postToWebhook(conn.webhookUrl, text);
    console.log(`[slack] rate-limit notification sent to user ${params.userId} (${params.scope})`);
  } catch (err) {
    console.warn('[slack] notification failed:', (err as Error).message);
  }
}
