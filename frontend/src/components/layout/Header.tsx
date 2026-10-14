'use client';

import Link from 'next/link';
import { useAuth } from '@/components/providers/AuthProvider';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { Logo } from './Logo';

export function Header({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-white px-4 sm:px-5">
      <button
        onClick={onMenu}
        className="rounded-full p-2 text-ink-soft hover:bg-surface-sunken lg:hidden"
        aria-label="Open navigation"
      >
        <Icon name="queue" />
      </button>
      <Link href="/dashboard/scheduled" className="mr-auto">
        <Logo />
      </Link>

      <div className="flex items-center gap-3">
        <Avatar name={user.name} src={user.avatarUrl} />
        <div className="hidden min-w-0 leading-tight sm:block">
          <p className="truncate text-sm font-medium text-ink">{user.name}</p>
          <p className="truncate text-xs text-ink-muted">{user.email}</p>
        </div>
        <button
          onClick={() => void logout()}
          className="ml-1 flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-ink-soft hover:bg-surface-sunken hover:text-ink"
        >
          <Icon name="logout" size={16} />
          <span className="hidden sm:inline">Log out</span>
        </button>
      </div>
    </header>
  );
}
