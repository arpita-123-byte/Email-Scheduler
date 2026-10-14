import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env, isProd } from '../config/env';

export const SESSION_COOKIE = 'outbox_session';

export interface SessionPayload {
  sub: string; // user id
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionPayload;
  }
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 7 * 24 * 3600 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function readSession(req: Request): SessionPayload | null {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) return null;
  try {
    return jwt.verify(token, env.JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  req.user = session;
  next();
}
