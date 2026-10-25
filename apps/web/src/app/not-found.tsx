import Link from 'next/link';
import { buttonVariants } from '@queuesprout/ui';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-muted">It may have moved, or you may not have access to it.</p>
      <Link href="/app" className={buttonVariants({ variant: 'secondary' })}>
        Go to your workspace
      </Link>
    </main>
  );
}
