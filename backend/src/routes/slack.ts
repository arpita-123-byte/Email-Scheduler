import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { slackConnections } from '../db/schema';
import { requireAuth, readSession } from '../middleware/auth';
import { asyncHandler } from '../middleware/errors';
import { buildSlackAuthorizeUrl, completeSlackOAuth, disconnectSlack, slackConfigured } from '../services/slack';

const router = Router();

router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const conn = await db.query.slackConnections.findFirst({
      where: eq(slackConnections.userId, req.user!.sub),
      columns: { teamName: true, channelName: true, createdAt: true },
    });
    res.json({ configured: slackConfigured(), connected: Boolean(conn), connection: conn });
  }),
);

/** Browser navigates here from "Connect Slack"; we redirect to Slack's consent screen. */
router.get('/connect', (req, res) => {
  const session = readSession(req);
  if (!session) {
    res.redirect(`${env.FRONTEND_URL}/`);
    return;
  }
  if (!slackConfigured()) {
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack=not_configured`);
    return;
  }
  // The state is a short-lived signed token carrying the user id. The callback
  // may arrive on a different host (e.g. an ngrok URL) where our session cookie
  // is not sent, so the user is identified from the state, not the cookie.
  const state = jwt.sign({ sub: session.sub, purpose: 'slack' }, env.JWT_SECRET, { expiresIn: '10m' });
  res.redirect(buildSlackAuthorizeUrl(state));
});

router.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error || !code || !state) {
      res.redirect(`${env.FRONTEND_URL}/dashboard?slack=${encodeURIComponent(error ?? 'cancelled')}`);
      return;
    }
    let userId: string;
    try {
      const payload = jwt.verify(state, env.JWT_SECRET) as { sub: string; purpose: string };
      if (payload.purpose !== 'slack') throw new Error('bad purpose');
      userId = payload.sub;
    } catch {
      res.redirect(`${env.FRONTEND_URL}/dashboard?slack=invalid_state`);
      return;
    }
    try {
      await completeSlackOAuth(userId, code);
      res.redirect(`${env.FRONTEND_URL}/dashboard?slack=connected`);
    } catch (err) {
      console.error('[slack] oauth error', err);
      res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error`);
    }
  }),
);

router.delete(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    await disconnectSlack(req.user!.sub);
    res.json({ ok: true });
  }),
);

export default router;
