import { CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { canManageMembers } from '@queuesprout/auth';
import { buttonVariants } from '@queuesprout/ui';
import { requireWorkspace } from '@/lib/session';

export default async function CalendarPage({ params }: PageProps<'/w/[slug]'>) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 py-24 text-center">
      <CalendarDays className="size-8 text-muted" aria-hidden="true" />
      <h1 className="text-lg font-semibold">Your calendar lives here</h1>
      <p className="text-muted">
        Scheduling and channels arrive in Phase 1. For now, invite your team so they are ready when
        it lands.
      </p>
      {canManageMembers(ctx) ? (
        <Link
          href={`/w/${slug}/settings/members` as '/'}
          className={buttonVariants({ variant: 'secondary' })}
        >
          Invite members
        </Link>
      ) : null}
    </div>
  );
}
