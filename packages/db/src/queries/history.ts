import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AttemptOutcome, ItemStatus, PublishErrorKind } from '@queuesprout/shared';
import type { Tx } from '../client';
import { findPgError, PG_INSUFFICIENT_PRIVILEGE } from '../errors';
import { postItems, posts, publishAttempts } from '../schema/posts';

/**
 * The post page's view of publishing: each item's result and every attempt, plus retrying
 * a failed post. Run inside withWorkspace(); viewers may read, editors may retry.
 */

export interface ItemResult {
  position: number;
  status: ItemStatus;
  externalUrl: string | null;
  errorMessage: string | null;
  publishedAt: Date | null;
}

export interface AttemptRow {
  attemptNo: number;
  /** The item the attempt worked on, if it still exists. */
  position: number | null;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: AttemptOutcome | null;
  errorKind: PublishErrorKind | null;
  httpStatus: number | null;
}

export interface PublishHistory {
  postId: string;
  errorKind: PublishErrorKind | null;
  items: ItemResult[];
  /** Newest first. */
  attempts: AttemptRow[];
}

/** Attempts shown per post; older ones are summarised by the count. */
export const ATTEMPT_HISTORY_LIMIT = 50;

export async function getPublishHistory(
  tx: Tx,
  workspaceId: string,
  postIds: string[],
): Promise<Map<string, PublishHistory & { attemptTotal: number }>> {
  const out = new Map<string, PublishHistory & { attemptTotal: number }>();
  if (postIds.length === 0) return out;

  const rows = await tx
    .select({ id: posts.id, errorKind: posts.errorKind })
    .from(posts)
    .where(and(inArray(posts.id, postIds), eq(posts.workspaceId, workspaceId)));
  for (const r of rows) {
    out.set(r.id, {
      postId: r.id,
      errorKind: r.errorKind,
      items: [],
      attempts: [],
      attemptTotal: 0,
    });
  }
  const ids = [...out.keys()];
  if (ids.length === 0) return out;

  const items = await tx
    .select({
      postId: postItems.postId,
      position: postItems.position,
      status: postItems.status,
      externalUrl: postItems.externalUrl,
      errorMessage: postItems.errorMessage,
      publishedAt: postItems.publishedAt,
    })
    .from(postItems)
    .where(inArray(postItems.postId, ids))
    .orderBy(asc(postItems.postId), asc(postItems.position));
  for (const { postId, ...item } of items) out.get(postId)?.items.push(item);

  // The newest attempts per post, numbered from the oldest.
  const attempts = await tx
    .select({
      postId: publishAttempts.postId,
      attemptNo: publishAttempts.attemptNo,
      position: postItems.position,
      startedAt: publishAttempts.startedAt,
      finishedAt: publishAttempts.finishedAt,
      outcome: publishAttempts.outcome,
      errorKind: publishAttempts.errorKind,
      httpStatus: publishAttempts.httpStatus,
      total: sql<number>`count(*) over (partition by ${publishAttempts.postId})::int`,
      rank: sql<number>`row_number() over (partition by ${publishAttempts.postId} order by ${publishAttempts.startedAt} desc, ${publishAttempts.attemptNo} desc)::int`,
    })
    .from(publishAttempts)
    .leftJoin(postItems, eq(postItems.id, publishAttempts.postItemId))
    .where(inArray(publishAttempts.postId, ids));
  attempts.sort((a, b) => a.rank - b.rank);
  for (const { postId, total, rank, ...attempt } of attempts) {
    const history = out.get(postId);
    if (!history) continue;
    history.attemptTotal = total;
    if (rank <= ATTEMPT_HISTORY_LIMIT) history.attempts.push(attempt);
  }
  return out;
}

export type RetryError =
  | 'not_found'
  | 'forbidden'
  | 'not_failed'
  | 'confirm_required'
  | 'account_needs_reauth'
  | 'channel_unavailable';

const RETRY_ERRORS = new Set<RetryError>([
  'not_found',
  'not_failed',
  'confirm_required',
  'account_needs_reauth',
  'channel_unavailable',
]);

/**
 * Sends a failed post back to the queue for now (app.retry_post). Items already published
 * stay published, so only what failed or never went out is sent.
 */
export async function retryPost(
  tx: Tx,
  postId: string,
  confirmUnknown: boolean,
): Promise<{ ok: true } | { ok: false; error: RetryError }> {
  try {
    // A savepoint, so a refusal leaves the caller's transaction usable.
    await tx.transaction((sp) =>
      sp.execute(sql`select app.retry_post(${postId}::uuid, ${confirmUnknown})`),
    );
    return { ok: true };
  } catch (error) {
    const pg = findPgError(error);
    if (pg?.code === PG_INSUFFICIENT_PRIVILEGE) return { ok: false, error: 'forbidden' };
    if (pg && RETRY_ERRORS.has(pg.message as RetryError)) {
      return { ok: false, error: pg.message as RetryError };
    }
    throw error;
  }
}
