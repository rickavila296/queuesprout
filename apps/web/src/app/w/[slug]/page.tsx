import { CalendarDays, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { hasRole } from '@queuesprout/core';
import {
  getWorkspace,
  listCalendarPosts,
  listChannels,
  listUnscheduledDrafts,
  type CalendarPost,
} from '@queuesprout/db';
import { addDays, startOfWallDay, toWallDate, toWallTime } from '@queuesprout/shared';
import { buttonVariants, cn } from '@queuesprout/ui';
import { PostStatusDot } from '@/components/post-status';
import { dataAccess } from '@/lib/db';
import { providerLabel } from '@/lib/providers';
import { requireWorkspace } from '@/lib/session';

export const metadata: Metadata = { title: 'Calendar' };

/** The list view shows the past week and the next eight weeks. */
const PAST_DAYS = 7;
const FUTURE_DAYS = 56;

const dayHeading = (day: string, today: string) => {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  if (day === addDays(today, -1)) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
};

export default async function CalendarPage({ params }: PageProps<'/w/[slug]'>) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const canEdit = hasRole(ctx.role, 'editor');

  const data = await dataAccess().withWorkspace(ctx, async (tx) => {
    const workspace = await getWorkspace(tx, ctx.workspaceId);
    const tz = workspace?.timezone ?? 'UTC';
    const today = toWallDate(new Date(), tz);
    const from = startOfWallDay(addDays(today, -PAST_DAYS), tz) ?? new Date();
    const to = startOfWallDay(addDays(today, FUTURE_DAYS), tz) ?? new Date();
    return {
      tz,
      today,
      channelCount: (await listChannels(tx, ctx.workspaceId)).length,
      posts: await listCalendarPosts(tx, ctx.workspaceId, { from, to }),
      drafts: await listUnscheduledDrafts(tx, ctx.workspaceId),
    };
  });
  const { tz, today, posts, drafts } = data;

  const days = new Map<string, CalendarPost[]>();
  for (const p of posts) {
    if (!p.scheduledAt) continue;
    const day = toWallDate(p.scheduledAt, tz);
    days.set(day, [...(days.get(day) ?? []), p]);
  }

  if (data.channelCount === 0 && posts.length === 0 && drafts.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 py-24 text-center">
        <CalendarDays className="size-8 text-muted" aria-hidden="true" />
        <h1 className="text-lg font-semibold">Your calendar lives here</h1>
        <p className="text-muted">Add a channel first, then schedule your first post.</p>
        <Link
          href={`/w/${slug}/channels` as '/'}
          className={buttonVariants({ variant: 'secondary' })}
        >
          Go to channels
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Calendar</h1>
          <p className="text-sm text-muted">Times in {tz}</p>
        </div>
        {canEdit && (
          <Link href={`/w/${slug}/compose` as '/'} className={buttonVariants()}>
            <Plus className="size-4" aria-hidden="true" />
            New post
          </Link>
        )}
      </div>

      {drafts.length > 0 && (
        <DaySection heading="Drafts without a time">
          {drafts.map((p) => (
            <PostRow key={p.id} post={p} slug={slug} time={null} />
          ))}
        </DaySection>
      )}

      {days.size === 0 ? (
        <p className="text-muted">Nothing scheduled in the next eight weeks.</p>
      ) : (
        [...days.entries()].map(([day, list]) => (
          <DaySection
            key={day}
            heading={dayHeading(day, today)}
            muted={day < today}
            current={day === today}
          >
            {list.map((p) => (
              <PostRow
                key={p.id}
                post={p}
                slug={slug}
                time={p.scheduledAt ? toWallTime(p.scheduledAt, tz).slice(11) : null}
              />
            ))}
          </DaySection>
        ))
      )}
    </div>
  );
}

function DaySection({
  heading,
  muted,
  current,
  children,
}: {
  heading: string;
  muted?: boolean;
  current?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2
        className={cn('text-sm font-medium', muted && 'text-muted', current && 'text-sprout-600')}
        aria-current={current ? 'date' : undefined}
      >
        {heading}
      </h2>
      <ul className="divide-y divide-border rounded-md border border-border">{children}</ul>
    </section>
  );
}

function PostRow({ post, slug, time }: { post: CalendarPost; slug: string; time: string | null }) {
  return (
    <li>
      <Link
        href={`/w/${slug}/posts/${post.groupId}` as '/'}
        className="flex items-start gap-3 px-3 py-2 hover:bg-surface-hover"
      >
        <span className="w-12 shrink-0 pt-0.5 text-sm tabular-nums text-muted">{time ?? '–'}</span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm">
            {post.body || <span className="text-muted">No text</span>}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
            <span>
              {post.channelName} · {providerLabel(post.provider)}
            </span>
            {post.itemCount > 1 && <span>Thread of {post.itemCount}</span>}
            {post.status === 'failed' && post.errorMessage && (
              <span className="text-danger">{post.errorMessage}</span>
            )}
          </span>
        </span>
        <PostStatusDot status={post.status} className="shrink-0 pt-0.5" />
      </Link>
    </li>
  );
}
