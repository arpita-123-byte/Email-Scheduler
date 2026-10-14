'use client';

import { toLocalInputValue } from '@/lib/format';
import { cn } from '@/lib/cn';

function preset(label: string, make: () => Date) {
  return { label, make };
}

const PRESETS = [
  preset('Now', () => new Date()),
  preset('In 5 min', () => new Date(Date.now() + 5 * 60_000)),
  preset('In 1 hour', () => new Date(Date.now() + 60 * 60_000)),
  preset('Tomorrow 9 AM', () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }),
];

/** Start time = when the first email may go out. Value is a datetime-local string. */
export function StartTimePicker({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <input
        id={id}
        type="datetime-local"
        value={value}
        min={toLocalInputValue(new Date())}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-line px-2 py-1.5 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const v = toLocalInputValue(p.make());
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(v)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors',
                value === v ? 'border-brand bg-brand-tint text-brand-dark' : 'border-line text-ink-soft hover:border-brand/50',
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
