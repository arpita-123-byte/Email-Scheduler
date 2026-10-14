/* eslint-disable @next/next/no-img-element */
import { initials } from '@/lib/format';
import { cn } from '@/lib/cn';

export function Avatar({ name, src, size = 36, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size };
  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={style}
        referrerPolicy="no-referrer"
        className={cn('shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span
      style={style}
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-brand-tint text-xs font-semibold text-brand-dark', className)}
    >
      {initials(name)}
    </span>
  );
}
