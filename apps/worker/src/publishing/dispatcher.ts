import type { Database } from '@queuesprout/db';
import { claimPosts } from '@queuesprout/db/publishing';

export type Enqueue = (postId: string, runAt?: Date) => Promise<void>;

/**
 * One dispatcher tick: claims due, status-check and stalled posts and enqueues one
 * publish.step for each. The database decides what is due, so rescheduling a post
 * never needs a job cancelled.
 */
export async function dispatchOnce(db: Database, enqueue: Enqueue, now: Date): Promise<number> {
  const claimed = await claimPosts(db, now);
  for (const { postId } of claimed) await enqueue(postId);
  return claimed.length;
}
