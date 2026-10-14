import { ButtonLink } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold text-ink">Page not found</h1>
      <ButtonLink href="/dashboard/scheduled" variant="outline">
        Go to scheduled emails
      </ButtonLink>
    </main>
  );
}
