const dateTime = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const timeOnly = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dateTime.format(new Date(iso));
}

/** Short, human label: "Today 3:05:12 PM", "Tomorrow 9:00 AM", or a full date. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayDiff = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - startOfToday) / 86_400_000);
  if (dayDiff === 0) return `Today ${timeOnly.format(d)}`;
  if (dayDiff === 1) return `Tomorrow ${timeOnly.format(d)}`;
  if (dayDiff === -1) return `Yesterday ${timeOnly.format(d)}`;
  return dateTime.format(d);
}

/** Value for <input type="datetime-local"> in the browser's own time zone. */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`;
}
