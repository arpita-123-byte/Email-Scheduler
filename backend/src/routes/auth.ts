import { Router } from 'express';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { env, isProd } from '../config/env';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { asyncHandler } from '../middleware/errors';
import { clearSessionCookie, readSession, setSessionCookie, signSession } from '../middleware/auth';

const router = Router();
const STATE_COOKIE = 'outbox_oauth_state';

function googleClient(): OAuth2Client {
  return new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

/** Step 1: redirect the browser to Google's consent screen (or local dev user if unconfigured). */
router.get(
  '/google',
  asyncHandler(async (_req, res) => {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      if (!isProd) {
        const demoProfile = { email: 'demo@outbox.local', name: 'Demo User', avatarUrl: null };
        const [user] = await db
          .insert(users)
          .values({ googleId: 'demo-local-user', ...demoProfile })
          .onConflictDoUpdate({ target: users.googleId, set: { ...demoProfile, updatedAt: new Date() } })
          .returning();

        setSessionCookie(res, signSession({ sub: user.id, email: user.email }));
        res.redirect(`${env.FRONTEND_URL}/dashboard`);
        return;
      }
      res.status(500).send('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
      return;
    }
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 10 * 60 * 1000, path: '/' });
    const url = googleClient().generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      prompt: 'select_account',
      state,
    });
    console.log('[auth] Initiating Google OAuth redirect');
    res.redirect(url);
  }),
);

/** Step 2: Google redirects back with a code; verify it and start a session. */
router.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    const expectedState = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: '/' });

    if (error) {
      console.error('[auth] Google OAuth error parameter:', error);
      res.redirect(`${env.FRONTEND_URL}/?error=${encodeURIComponent(error)}`);
      return;
    }

    if (!code || !state || state !== expectedState) {
      console.error('[auth] OAuth state verification failed:', {
        hasCode: !!code,
        hasReceivedState: !!state,
        hasExpectedState: !!expectedState,
        statesMatch: state === expectedState,
      });
      res.redirect(`${env.FRONTEND_URL}/?error=oauth_state_mismatch`);
      return;
    }

    try {
      const client = googleClient();
      const { tokens } = await client.getToken(code);
      if (!tokens.id_token) throw new Error('Google did not return an id_token');
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
      const p = ticket.getPayload();
      if (!p?.sub || !p.email) throw new Error('Google profile is missing id or email');

      const profile = { email: p.email, name: p.name ?? p.email, avatarUrl: p.picture ?? null };
      const [user] = await db
        .insert(users)
        .values({ googleId: p.sub, ...profile })
        .onConflictDoUpdate({ target: users.googleId, set: { ...profile, updatedAt: new Date() } })
        .returning();

      setSessionCookie(res, signSession({ sub: user.id, email: user.email }));
      console.log(`[auth] Successfully authenticated user: ${user.email}`);
      res.redirect(`${env.FRONTEND_URL}/dashboard`);
    } catch (err) {
      console.error('[auth] Token exchange error:', err);
      res.redirect(`${env.FRONTEND_URL}/?error=${encodeURIComponent((err as Error).message)}`);
    }
  }),
);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const session = readSession(req);
    if (!session) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.sub),
      columns: { id: true, email: true, name: true, avatarUrl: true },
    });
    if (!user) {
      clearSessionCookie(res);
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.json({ user });
  }),
);

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
