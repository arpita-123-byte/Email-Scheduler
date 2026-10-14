'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { Spinner } from '@/components/ui/Spinner';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [loading, user, router]);

  useEffect(() => setNavOpen(false), [pathname]);

  if (loading || !user) {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        <Spinner size={22} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header onMenu={() => setNavOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Suspense>
          <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        </Suspense>
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
