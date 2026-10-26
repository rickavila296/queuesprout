import type { PostStatus } from '@queuesprout/shared';

/**
 * The dispatcher claims due posts every 15 s, so a post still "scheduled" this long after its
 * time means the worker is not running. Say so instead of "Scheduled".
 */
const OVERDUE_MS = 2 * 60_000;

export function isOverdue(
  post: { status: PostStatus; scheduledAt: Date | null },
  now: Date,
): boolean {
  return (
    post.status === 'scheduled' &&
    post.scheduledAt !== null &&
    now.getTime() - post.scheduledAt.getTime() > OVERDUE_MS
  );
}
