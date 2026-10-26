import { z } from 'zod';
import { toWallDate, toWallTime, type ComposeMode } from '@queuesprout/shared';

/**
 * The confirmation the calendar shows after the composer saves. It travels in the redirect
 * URL, so it survives the redirect without a session store and disappears on the next
 * navigation. Everything in it is re-validated and only ever rendered as text.
 */
export interface SavedNotice {
  mode: ComposeMode;
  groupId: string;
  channels: number;
  /** When it publishes; absent for "now" and for undated drafts. */
  at: Date | null;
}

const noticeSchema = z.object({
  saved: z.enum(['schedule', 'now', 'draft']),
  group: z.uuid(),
  channels: z.coerce.number().int().min(0).max(1000),
  at: z.iso.datetime().optional(),
});

/** Query string for the calendar redirect: the notice, plus the day to open on. */
export function savedNoticeQuery(notice: SavedNotice, timeZone: string): string {
  const params = new URLSearchParams({
    saved: notice.mode,
    group: notice.groupId,
    channels: String(notice.channels),
  });
  if (notice.at && notice.mode !== 'now') {
    params.set('at', notice.at.toISOString());
    params.set('date', toWallDate(notice.at, timeZone));
  }
  return params.toString();
}

export function parseSavedNotice(
  query: Record<string, string | string[] | undefined>,
): SavedNotice | null {
  const parsed = noticeSchema.safeParse(query);
  if (!parsed.success) return null;
  const { saved, group, channels, at } = parsed.data;
  return { mode: saved, groupId: group, channels, at: at ? new Date(at) : null };
}

function when(at: Date, timeZone: string, now: Date): string {
  const time = toWallTime(at, timeZone).slice(11);
  const day = toWallDate(at, timeZone);
  if (day === toWallDate(now, timeZone)) return `today at ${time}`;
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(at);
  return `${date} at ${time}`;
}

export function savedNoticeText(notice: SavedNotice, timeZone: string, now: Date): string {
  const on = `${notice.channels} ${notice.channels === 1 ? 'channel' : 'channels'}`;
  if (notice.mode === 'now') return `Publishing now to ${on}. It should be live within a minute.`;
  if (notice.mode === 'draft') {
    return notice.at ? `Draft saved for ${when(notice.at, timeZone, now)}.` : 'Draft saved.';
  }
  return notice.at
    ? `Scheduled for ${when(notice.at, timeZone, now)} on ${on}.`
    : `Scheduled on ${on}.`;
}
