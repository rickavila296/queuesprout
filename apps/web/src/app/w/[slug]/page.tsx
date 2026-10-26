import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { hasRole } from '@queuesprout/core';
import {
  getWorkspace,
  listCalendarPosts,
  listChannels,
  listUnscheduledDrafts,
} from '@queuesprout/db';
import {
  addDays,
  addMonths,
  DAY_PATTERN,
  startOfMonthGrid,
  startOfWallDay,
  startOfWeek,
  toWallDate,
  toWallTime,
} from '@queuesprout/shared';
import { buttonVariants, cn } from '@queuesprout/ui';
import { CalendarGrid, type GridPost } from '@/components/calendar/calendar-grid';
import { ListView } from '@/components/calendar/list-view';
import { dataAccess } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';

export const metadata: Metadata = { title: 'Calendar' };

const VIEWS = ['week', 'month', 'list'] as const;
type View = (typeof VIEWS)[number];

/** The list view shows the week before the anchor day and the eight weeks after it. */
const LIST_PAST_DAYS = 7;
const LIST_FUTURE_DAYS = 56;

/** First and last (exclusive) day of the period a view shows around `anchor`. */
function period(view: View, anchor: string): { first: string; end: string } {
  if (view === 'week') {
    const first = startOfWeek(anchor);
    return { first, end: addDays(first, 7) };
  }
  if (view === 'month') {
    const first = startOfMonthGrid(anchor);
    return { first, end: addDays(first, 42) };
  }
  return { first: addDays(anchor, -LIST_PAST_DAYS), end: addDays(anchor, LIST_FUTURE_DAYS) };
}

function step(view: View, anchor: string, direction: 1 | -1): string {
  if (view === 'month') return addMonths(anchor, direction);
  return addDays(anchor, direction * (view === 'week' ? 7 : LIST_FUTURE_DAYS));
}

function title(view: View, anchor: string, first: string, end: string): string {
  const fmt = (day: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(
      new Date(Date.UTC(y, m - 1, d)),
    );
  };
  if (view === 'month') return fmt(anchor, { month: 'long', year: 'numeric' });
  const last = addDays(end, -1);
  return `${fmt(first, { month: 'short', day: 'numeric' })} – ${fmt(last, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export default async function CalendarPage({ params, searchParams }: PageProps<'/w/[slug]'>) {
  const { slug } = await params;
  const query = await searchParams;
  const { ctx } = await requireWorkspace(slug);
  const canEdit = hasRole(ctx.role, 'editor');
  const view: View = VIEWS.find((v) => v === query.view) ?? 'week';

  const data = await dataAccess().withWorkspace(ctx, async (tx) => {
    const workspace = await getWorkspace(tx, ctx.workspaceId);
    const tz = workspace?.timezone ?? 'UTC';
    const today = toWallDate(new Date(), tz);
    const anchor =
      typeof query.date === 'string' &&
      DAY_PATTERN.test(query.date) &&
      startOfWallDay(query.date, tz)
        ? query.date
        : today;
    const { first, end } = period(view, anchor);
    const from = startOfWallDay(first, tz) ?? new Date();
    const to = startOfWallDay(end, tz) ?? new Date();
    return {
      tz,
      today,
      anchor,
      first,
      end,
      channelCount: (await listChannels(tx, ctx.workspaceId)).length,
      posts: await listCalendarPosts(tx, ctx.workspaceId, { from, to, limit: 1000 }),
      drafts: view === 'list' ? await listUnscheduledDrafts(tx, ctx.workspaceId) : [],
    };
  });
  const { tz, today, anchor, first, end, posts, drafts } = data;

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

  const href = (v: View, date?: string) =>
    `/w/${slug}?view=${v}${date && date !== today ? `&date=${date}` : ''}` as '/';
  const days = Array.from({ length: view === 'week' ? 7 : 42 }, (_, i) => addDays(first, i));
  const gridPosts: GridPost[] = posts.flatMap((p) =>
    p.scheduledAt
      ? [
          {
            id: p.id,
            groupId: p.groupId,
            status: p.status,
            day: toWallDate(p.scheduledAt, tz),
            time: toWallTime(p.scheduledAt, tz).slice(11),
            channelName: p.channelName,
            provider: p.provider,
            body: p.body,
            version: p.version,
          },
        ]
      : [],
  );

  return (
    <div className={cn('mx-auto flex flex-col gap-4', view === 'list' ? 'max-w-3xl' : 'max-w-6xl')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-lg font-semibold sm:text-xl">
            {title(view, anchor, first, end)}
          </h1>
          <Link
            href={href(view, step(view, anchor, -1))}
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            aria-label="Previous"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Link>
          <Link href={href(view)} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Today
          </Link>
          <Link
            href={href(view, step(view, anchor, 1))}
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            aria-label="Next"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <nav aria-label="Calendar view" className="flex rounded-sm border border-border p-0.5">
            {VIEWS.map((v) => (
              <Link
                key={v}
                href={href(v, anchor)}
                aria-current={v === view ? 'page' : undefined}
                className={cn(
                  'rounded-sm px-2.5 py-1 text-sm capitalize',
                  v === view
                    ? 'bg-sprout-100 font-medium text-sprout-600'
                    : 'text-muted hover:text-text',
                )}
              >
                {v}
              </Link>
            ))}
          </nav>
          {canEdit && (
            <Link href={`/w/${slug}/compose` as '/'} className={buttonVariants()}>
              <Plus className="size-4" aria-hidden="true" />
              New post
            </Link>
          )}
        </div>
      </div>

      {view === 'list' ? (
        <>
          <p className="text-sm text-muted">Times in {tz}</p>
          <ListView slug={slug} timezone={tz} today={today} posts={posts} drafts={drafts} />
        </>
      ) : (
        <CalendarGrid
          // A new period starts with fresh local state.
          key={`${view}:${first}`}
          slug={slug}
          view={view}
          days={days}
          month={view === 'month' ? anchor.slice(0, 7) : undefined}
          today={today}
          timezone={tz}
          posts={gridPosts}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
