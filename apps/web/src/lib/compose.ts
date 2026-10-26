import {
  getProviderDefinition,
  type ChannelPost,
  type ValidationIssue,
} from '@queuesprout/providers/client';
import {
  countChars,
  toWallTime,
  wallTimeToUtc,
  type ComposeMode,
  type ItemMedia,
  type ProviderId,
} from '@queuesprout/shared';

/**
 * Validation shared by the composer (live, in the browser) and its Server Action
 * (authoritative). Both run the adapter's own validate(), so they cannot disagree.
 */
export function validateThread(
  channel: { id: string; provider: ProviderId; defaultSettings: Record<string, unknown> },
  items: readonly string[],
  media: readonly (readonly ItemMedia[])[] = [],
): ValidationIssue[] {
  const post: ChannelPost = {
    id: 'draft',
    channelId: channel.id,
    provider: channel.provider,
    settings: channel.defaultSettings,
    items: items.map((body, position) => ({
      id: `draft-${position}`,
      position,
      kind: position === 0 ? 'post' : 'reply',
      body,
      mediaIds: (media[position] ?? []).map((m) => m.mediaId),
    })),
  };
  return getProviderDefinition(channel.provider).validate(post, []);
}

/** Characters used and allowed for one item on one provider. */
export function charCount(provider: ProviderId, body: string): { used: number; max: number } {
  const { limits } = getProviderDefinition(provider);
  return { used: countChars(body, limits.countMode), max: limits.maxChars };
}

export type ScheduleResult =
  | { ok: true; status: 'draft' | 'scheduled'; scheduledAt: Date | null }
  | { ok: false; error: string };

/** A save may land a little after the time the user picked; allow this much slack. */
export const PAST_SLACK_MS = 60_000;

/**
 * Turns the composer's mode and wall-clock time (in the workspace timezone) into the
 * status and UTC time to store. Publish now is a post scheduled for this instant: the
 * dispatcher picks it up on its next pass.
 */
export function resolveSchedule(
  mode: ComposeMode,
  wall: string | undefined,
  timeZone: string,
  now: Date,
): ScheduleResult {
  if (mode === 'now') return { ok: true, status: 'scheduled', scheduledAt: now };
  const at = wall ? wallTimeToUtc(wall, timeZone) : null;
  if (wall && !at) return { ok: false, error: 'Pick a valid date and time.' };
  if (mode === 'draft') return { ok: true, status: 'draft', scheduledAt: at };
  if (!at) return { ok: false, error: 'Pick a date and time.' };
  if (at.getTime() < now.getTime() - PAST_SLACK_MS) {
    return { ok: false, error: 'That time has passed. Pick a later one or publish now.' };
  }
  return { ok: true, status: 'scheduled', scheduledAt: at };
}

/** Default for a new post: the next quarter hour at least 30 minutes away, as wall time. */
export function defaultScheduleWall(now: Date, timeZone: string): string {
  const quarter = 15 * 60_000;
  const at = new Date(Math.ceil((now.getTime() + 30 * 60_000) / quarter) * quarter);
  return toWallTime(at, timeZone);
}
