'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type DragEvent } from 'react';
import type { PostStatus, ProviderId } from '@queuesprout/shared';
import { Button, cn, FieldError, Input, Label } from '@queuesprout/ui';
import { reschedulePostAction } from '@/app/w/[slug]/actions';
import { statusDotClass, statusLabel } from '@/components/post-status';
import { providerLabel } from '@/lib/providers';

export interface GridPost {
  id: string;
  groupId: string;
  status: PostStatus;
  /** Workspace-local day and time, computed on the server. */
  day: string;
  time: string;
  channelName: string;
  provider: ProviderId;
  body: string;
  version: number;
}

interface Props {
  slug: string;
  view: 'week' | 'month';
  days: string[];
  /** "YYYY-MM" of the month shown; days outside it are dimmed. */
  month?: string;
  today: string;
  timezone: string;
  posts: GridPost[];
  canEdit: boolean;
}

interface Placement {
  day: string;
  time: string;
  version: number;
}

interface Toast {
  message: string;
  undo?: () => void;
}

const MONTH_CHIPS = 3;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DRAG_TYPE = 'application/x-queuesprout-post';

const movable = (p: { status: PostStatus }) => p.status === 'draft' || p.status === 'scheduled';

/**
 * Week and month views. Drafts and scheduled posts can be dragged to another day (the
 * time of day stays) or moved with "Move to…" from the keyboard. Moves apply at once,
 * roll back if the server refuses them, and offer Undo.
 */
export function CalendarGrid({ slug, view, days, month, today, timezone, posts, canEdit }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Local placements win until the server data catches up (same or newer version).
  const [placed, setPlaced] = useState<Record<string, Placement>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const [moving, setMoving] = useState<GridPost | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(id);
  }, [toast]);

  const effective = posts.map((p) => {
    const local = placed[p.id];
    return local && local.version >= p.version ? { ...p, ...local } : p;
  });
  const byDay = new Map<string, GridPost[]>();
  for (const p of [...effective].sort((a, b) => a.time.localeCompare(b.time))) {
    byDay.set(p.day, [...(byDay.get(p.day) ?? []), p]);
  }

  /** from defaults to where the post shows now; Undo passes it, since its closure is older. */
  async function move(post: GridPost, day: string, time: string, undoFrom?: Placement) {
    const from: Placement = undoFrom ?? effective.find((p) => p.id === post.id) ?? post;
    if (from.day === day && from.time === time) return;
    // Optimistic: show it at the new place with the version the server will give it.
    setPlaced((s) => ({ ...s, [post.id]: { day, time, version: from.version + 1 } }));
    const result = await reschedulePostAction({
      workspaceSlug: slug,
      postId: post.id,
      version: from.version,
      wall: `${day}T${time}`,
    });
    if (!result.ok) {
      setPlaced((s) => ({
        ...s,
        [post.id]: { day: from.day, time: from.time, version: from.version },
      }));
      setToast({ message: result.error });
      return;
    }
    const version = result.data.version;
    setPlaced((s) => ({ ...s, [post.id]: { day, time, version } }));
    startTransition(() => router.refresh());
    setToast({
      message: `Moved to ${formatDay(day)} at ${time}.`,
      ...(!undoFrom && {
        undo: () => {
          setToast(null);
          void move(post, from.day, from.time, { day, time, version });
        },
      }),
    });
  }

  const onDrop = (day: string) => (e: DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const post = effective.find((p) => p.id === id);
    if (post && canDropOn(post, day, today)) void move(post, day, post.time);
  };

  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          'grid-cols-7 gap-px text-xs font-medium text-muted',
          view === 'week' ? 'hidden sm:grid' : 'grid',
        )}
        aria-hidden="true"
      >
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-1">
            {d}
          </div>
        ))}
      </div>
      <div
        role="grid"
        aria-label={view === 'week' ? 'Week' : 'Month'}
        className="grid gap-px overflow-hidden rounded-md border border-border bg-border"
      >
        {weeks.map((week) => (
          <div
            role="row"
            key={week[0]}
            // On phones a week stacks its days; a month stays a grid.
            className={cn(
              'grid gap-px',
              view === 'week' ? 'grid-cols-1 sm:grid-cols-7' : 'grid-cols-7',
            )}
          >
            {week.map((day) => {
              const list = byDay.get(day) ?? [];
              const shown = view === 'month' ? list.slice(0, MONTH_CHIPS) : list;
              const outside = month !== undefined && !day.startsWith(month);
              return (
                <div
                  role="gridcell"
                  key={day}
                  aria-label={formatDay(day)}
                  onDragOver={(e) => {
                    if (!canEdit || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
                    e.preventDefault();
                    setDragOver(day);
                  }}
                  onDragLeave={() => setDragOver((d) => (d === day ? null : d))}
                  onDrop={onDrop(day)}
                  className={cn(
                    'flex flex-col gap-1 bg-bg p-1.5',
                    view === 'week' ? 'min-h-16 sm:min-h-64' : 'min-h-28',
                    outside && 'bg-surface',
                    dragOver === day && 'outline-2 -outline-offset-2 outline-sprout-600',
                  )}
                >
                  <span
                    className={cn(
                      'self-start rounded-sm px-1 text-xs tabular-nums',
                      day === today ? 'bg-sprout-600 font-medium text-sprout-fg' : 'text-muted',
                      outside && 'opacity-60',
                    )}
                  >
                    {view === 'week' ? formatDay(day) : Number(day.slice(8))}
                  </span>
                  {shown.map((p) => (
                    <Chip
                      key={p.id}
                      post={p}
                      slug={slug}
                      compact={view === 'month'}
                      draggable={canEdit && movable(p)}
                      onMove={() => setMoving(p)}
                    />
                  ))}
                  {list.length > shown.length && (
                    <span className="px-1 text-xs text-muted">
                      +{list.length - shown.length} more
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        Times in {timezone}.
        {canEdit
          ? ' Drag a draft or scheduled post to another day, or press ⋯ on it to pick a time.'
          : ''}
      </p>

      {moving && (
        <MoveDialog
          post={effective.find((p) => p.id === moving.id) ?? moving}
          timezone={timezone}
          onClose={() => setMoving(null)}
          onSave={(day, time) => {
            setMoving(null);
            void move(moving, day, time);
          }}
        />
      )}

      <div aria-live="polite" className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        {toast && (
          <div
            role="status"
            className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-lg"
          >
            <span>{toast.message}</span>
            {toast.undo && (
              <Button size="sm" variant="secondary" onClick={toast.undo}>
                Undo
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function canDropOn(post: GridPost, day: string, today: string) {
  return movable(post) && (post.status === 'draft' || day >= today);
}

function formatDay(day: string) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function Chip({
  post,
  slug,
  compact,
  draggable,
  onMove,
}: {
  post: GridPost;
  slug: string;
  compact: boolean;
  draggable: boolean;
  onMove: () => void;
}) {
  const channel = `${providerLabel(post.provider)} (${post.channelName})`;
  const label = `${post.time} ${channel}, ${statusLabel(post.status)}: ${post.body || 'No text'}`;
  return (
    <div
      className={cn(
        'group flex items-start gap-1 rounded-sm border border-border bg-surface text-xs hover:bg-surface-hover',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, post.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <Link
        href={`/w/${slug}/posts/${post.groupId}` as '/'}
        draggable={false}
        aria-label={label}
        title={`${channel}: ${post.body}`}
        className="flex min-w-0 flex-1 items-start gap-1.5 px-1.5 py-1"
      >
        <span
          className={cn('mt-1 size-2 shrink-0 rounded-full', statusDotClass(post.status))}
          aria-hidden="true"
        />
        {compact ? (
          <span className="min-w-0 flex-1 truncate">
            <span className="tabular-nums text-muted">{post.time}</span>{' '}
            <span className="font-medium">{channel}</span>
          </span>
        ) : (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="tabular-nums text-muted">{post.time}</span>
            <span className="truncate font-medium">{channel}</span>
            <span className="line-clamp-2 text-muted">{post.body || 'No text'}</span>
          </span>
        )}
      </Link>
      {draggable && (
        <button
          type="button"
          onClick={onMove}
          // Hidden until hover only where there is hover; touch screens always show it.
          className="shrink-0 rounded-sm px-1 py-1 text-muted hover:text-text pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
          aria-label={`Move ${channel} post at ${post.time} to another time`}
        >
          ⋯
        </button>
      )}
    </div>
  );
}

function MoveDialog({
  post,
  timezone,
  onClose,
  onSave,
}: {
  post: GridPost;
  timezone: string;
  onClose: () => void;
  onSave: (day: string, time: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(`${post.day}T${post.time}`);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="move-title"
      className="m-auto w-full max-w-sm rounded-md border border-border bg-bg p-4 text-text backdrop:bg-black/40"
    >
      <form
        method="dialog"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
          if (!m?.[1] || !m[2]) {
            setError('Pick a date and time.');
            return;
          }
          onSave(m[1], m[2]);
        }}
      >
        <h2 id="move-title" className="font-medium">
          Move to…
        </h2>
        <p className="line-clamp-2 text-sm text-muted">
          {providerLabel(post.provider)} ({post.channelName}): {post.body || 'No text'}
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="move-at">Date and time ({timezone})</Label>
          <Input
            id="move-at"
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            autoFocus
          />
          <FieldError>{error}</FieldError>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <Button type="submit">Move</Button>
        </div>
      </form>
    </dialog>
  );
}
