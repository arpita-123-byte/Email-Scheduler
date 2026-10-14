'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Logo } from '@/components/layout/Logo';
import { Spinner } from '@/components/ui/Spinner';

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

const ERRORS: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled.',
  oauth_state_mismatch: 'Your sign-in session expired. Try again.',
};

function LoginInner() {
  const { user, loading, error } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const oauthError = params.get('error');

  useEffect(() => {
    if (user) router.replace('/dashboard/scheduled');
  }, [user, router]);

  return (
    <main className="flex min-h-full items-center justify-center bg-surface-sunken px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white px-8 py-10 shadow-pop">
        <Logo />
        <h1 className="mt-8 text-2xl font-semibold tracking-tight text-ink">Log in</h1>
        <p className="mt-1 text-sm text-ink-muted">Schedule outbound emails and watch them go out.</p>

        {(oauthError || error) && (
          <p role="alert" className="mt-5 rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger break-words">
            {oauthError ? (ERRORS[oauthError] ?? `Google sign-in error: ${oauthError}`) : error}
          </p>
        )}

        {loading || user ? (
          <div className="mt-8 flex justify-center text-ink-muted">
            <Spinner />
          </div>
        ) : (
          <a
            href={api.googleLoginUrl}
            className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-full border border-line bg-white text-sm font-medium text-ink transition-colors hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-brand"
          >
            <GoogleMark />
            Continue with Google
          </a>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
