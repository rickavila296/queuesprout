import Link from 'next/link';
import type { CalendarPost } from '@queuesprout/db';
import { addDays, toWallDate, toWallTime } from '@queuesprout/shared';
import { cn } from '@queuesprout/ui';
import { PostStatusDot } from '@/components/post-status';
import { isOverdue } from '@/lib/post-timing';
import { providerLabel } from '@/lib/providers';

export const dayHeading = (day: string, today: string) => {
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

/** Agenda list: drafts without a time, then each day that has posts. */
export function ListView({
  slug,
  timezone,
  today,
  now,
  posts,
  drafts,
}: {
  slug: string;
  timezone: string;
  today: string;
  /** Request time, for flagging posts that are past due. */
  now: Date;
  posts: CalendarPost[];
  drafts: CalendarPost[];
}) {
  const days = new Map<string, CalendarPost[]>();
  for (const p of posts) {
    if (!p.scheduledAt) continue;
    const day = toWallDate(p.scheduledAt, timezone);
    days.set(day, [...(days.get(day) ?? []), p]);
  }
  return (
    <>
      {drafts.length > 0 && (
        <DaySection heading="Drafts without a time">
          {drafts.map((p) => (
            <PostRow now={now} key={p.id} post={p} slug={slug} time={null} />
          ))}
        </DaySection>
      )}
      {days.size === 0 ? (
        <p className="text-muted">Nothing scheduled in this period.</p>
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
                now={now}
                key={p.id}
                post={p}
                slug={slug}
                time={p.scheduledAt ? toWallTime(p.scheduledAt, timezone).slice(11) : null}
              />
            ))}
          </DaySection>
        ))
      )}
    </>
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

function PostRow({
  post,
  slug,
  time,
  now,
}: {
  post: CalendarPost;
  slug: string;
  time: string | null;
  now: Date;
}) {
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
              {providerLabel(post.provider)} · {post.channelName}
            </span>
            {post.itemCount > 1 && <span>Thread of {post.itemCount}</span>}
            {post.status === 'failed' && post.errorMessage && (
              <span className="text-danger">{post.errorMessage}</span>
            )}
          </span>
        </span>
        <PostStatusDot
          status={post.status}
          overdue={isOverdue(post, now)}
          className="shrink-0 pt-0.5"
        />
      </Link>
    </li>
  );
}
