import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type {
  AttemptOutcome,
  ProviderId,
  PublishCheckpoint,
  PublishErrorKind,
} from '@queuesprout/shared';
import type { Database, Tx } from '../client';
import { channels, connectedAccounts } from '../schema/accounts';
import { postItems, posts, publishAttempts } from '../schema/posts';
import { workspaces } from '../schema/workspaces';

/**
 * The worker's side of the publishing pipeline. Exported as
 * "@queuesprout/db/publishing" and lint-banned in apps/web: these run as the owner
 * role and move posts through the worker-only statuses.
 */

/** Posts left in queued or publishing this long without an update lost their job; re-enqueue. */
export const STALE_STEP_MS = 10 * 60_000;
/** While a status check is enqueued, push next_check_at out so the dispatcher skips it. */
export const CHECK_LEASE_MS = 5 * 60_000;

export interface ClaimedPost {
  postId: string;
  reason: 'due' | 'check' | 'stale';
}

/**
 * Picks posts that need a step: due scheduled posts (flipped to queued), processing
 * posts whose status check is due (leased), and in-flight posts whose job was lost.
 * FOR UPDATE SKIP LOCKED lets several dispatchers run without claiming a post twice.
 */
export async function claimPosts(db: Database, now: Date, limit = 100): Promise<ClaimedPost[]> {
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + CHECK_LEASE_MS).toISOString();
  const staleBefore = new Date(now.getTime() - STALE_STEP_MS).toISOString();
  const result = await db.execute<{ id: string; previous: string }>(sql`
    with picked as (
      select id, status from posts
      where deleted_at is null and (
        (status = 'scheduled' and scheduled_at <= ${nowIso}::timestamptz)
        or (status = 'processing' and next_check_at <= ${nowIso}::timestamptz)
        or (status in ('queued', 'publishing') and updated_at <= ${staleBefore}::timestamptz)
      )
      order by coalesce(next_check_at, scheduled_at, updated_at)
      limit ${limit}
      for update skip locked
    )
    update posts p set
      status = case when picked.status = 'scheduled' then 'queued'::post_status else p.status end,
      next_check_at = case when picked.status = 'processing'
                           then ${leaseUntil}::timestamptz else p.next_check_at end
    from picked where p.id = picked.id
    returning p.id, picked.status::text as previous`);
  return result.rows.map((r) => ({
    postId: r.id,
    reason: r.previous === 'scheduled' ? 'due' : r.previous === 'processing' ? 'check' : 'stale',
  }));
}

export interface ItemRefRow {
  externalId: string;
  url: string | null;
  meta: Record<string, unknown>;
}

export interface StepWork {
  postId: string;
  workspaceId: string;
  workspaceIsSandbox: boolean;
  provider: ProviderId;
  settings: Record<string, unknown>;
  items: Array<{
    id: string;
    position: number;
    kind: 'post' | 'reply' | 'first_comment';
    body: string;
  }>;
  item: { id: string; position: number; kind: 'post' | 'reply' | 'first_comment'; body: string };
  parent: ItemRefRow | null;
  root: ItemRefRow | null;
  checkpoint: PublishCheckpoint | null;
  retriesSoFar: number;
  channel: { id: string; targetType: string; externalTargetId: string };
  account: { id: string; externalAccountId: string };
  attemptId: string;
}

export type BeginStepResult =
  | { kind: 'work'; work: StepWork }
  /** Nothing to do: cancelled, already published, or not in flight. */
  | { kind: 'skip'; reason: string }
  /** Every item was already out; the post is now published. */
  | { kind: 'published' }
  /** A previous step died mid-call. Recorded as unknown, the post failed: verify on platform. */
  | { kind: 'interrupted' }
  /** The account or channel cannot publish; the post failed without calling the platform. */
  | { kind: 'blocked'; errorKind: PublishErrorKind; message: string };

const IN_FLIGHT = ['queued', 'publishing', 'processing'] as const;

const toRef = (row: {
  externalId: string | null;
  externalUrl: string | null;
  externalMeta: Record<string, unknown>;
}): ItemRefRow | null =>
  row.externalId
    ? { externalId: row.externalId, url: row.externalUrl, meta: row.externalMeta }
    : null;

async function failPost(
  tx: Tx,
  postId: string,
  itemId: string | null,
  errorKind: PublishErrorKind,
  message: string,
) {
  await tx
    .update(posts)
    .set({ status: 'failed', errorKind, errorMessage: message, nextCheckAt: null })
    .where(eq(posts.id, postId));
  if (itemId) {
    await tx
      .update(postItems)
      .set({ status: 'failed', errorMessage: message })
      .where(eq(postItems.id, itemId));
  }
}

/**
 * Locks the post, picks its next unpublished item and opens a publish_attempts row,
 * then commits, so the platform call runs outside any transaction. An attempt row
 * that is still open means a step died after it may have reached the platform.
 */
export async function beginStep(db: Database, postId: string, now: Date): Promise<BeginStepResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        post: posts,
        workspaceIsSandbox: workspaces.isSandbox,
        channel: channels,
        account: connectedAccounts,
      })
      .from(posts)
      .innerJoin(workspaces, eq(workspaces.id, posts.workspaceId))
      .innerJoin(channels, eq(channels.id, posts.channelId))
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, channels.accountId))
      .where(eq(posts.id, postId))
      .for('update', { of: posts });
    if (!row) return { kind: 'skip', reason: 'not_found' };
    const { post, channel, account } = row;
    if (post.deletedAt || !(IN_FLIGHT as readonly string[]).includes(post.status)) {
      return { kind: 'skip', reason: `status_${post.status}` };
    }

    const items = await tx
      .select()
      .from(postItems)
      .where(eq(postItems.postId, postId))
      .orderBy(asc(postItems.position));
    const next = items.find((i) => i.status === 'pending');

    const open = await tx
      .select({ id: publishAttempts.id })
      .from(publishAttempts)
      .where(and(eq(publishAttempts.postId, postId), isNull(publishAttempts.finishedAt)));
    if (open.length > 0) {
      const message = 'A publish step was interrupted after it may have reached the platform.';
      await tx
        .update(publishAttempts)
        .set({ finishedAt: now, outcome: 'unknown', errorKind: 'unknown' })
        .where(and(eq(publishAttempts.postId, postId), isNull(publishAttempts.finishedAt)));
      await failPost(tx, postId, next?.id ?? null, 'unknown', `${message} Check the platform.`);
      return { kind: 'interrupted' };
    }

    if (!next) {
      await tx
        .update(posts)
        .set({ status: 'published', publishedAt: post.publishedAt ?? now, nextCheckAt: null })
        .where(eq(posts.id, postId));
      return { kind: 'published' };
    }

    if (account.status !== 'active') {
      const message = 'Reconnect this account to publish.';
      await failPost(tx, postId, next.id, 'auth', message);
      return { kind: 'blocked', errorKind: 'auth', message };
    }
    if (channel.status === 'disabled' || channel.status === 'target_missing') {
      const message = 'This channel is unavailable. Check it in Settings.';
      await failPost(tx, postId, next.id, 'validation', message);
      return { kind: 'blocked', errorKind: 'validation', message };
    }

    // processing stays processing during status checks; everything else is publishing.
    if (post.status === 'queued') {
      await tx.update(posts).set({ status: 'publishing' }).where(eq(posts.id, postId));
    }

    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(publishAttempts)
      .where(eq(publishAttempts.postId, postId));
    const cp = post.publishCheckpoint;
    const [attempt] = await tx
      .insert(publishAttempts)
      .values({
        workspaceId: post.workspaceId,
        postId,
        postItemId: next.id,
        attemptNo: n + 1,
        stage: cp && cp.position === next.position ? cp.stage : null,
        startedAt: now,
      })
      .returning({ id: publishAttempts.id });
    if (!attempt) throw new Error('could not open publish attempt');

    const previous = items.find((i) => i.position === next.position - 1);
    const first = items[0];
    const checkpoint =
      cp && cp.position === next.position ? (({ position: _p, ...rest }) => rest)(cp) : null;

    return {
      kind: 'work',
      work: {
        postId,
        workspaceId: post.workspaceId,
        workspaceIsSandbox: row.workspaceIsSandbox,
        provider: channel.provider,
        settings: { ...channel.defaultSettings, ...post.settings },
        items: items.map((i) => ({ id: i.id, position: i.position, kind: i.kind, body: i.body })),
        item: { id: next.id, position: next.position, kind: next.kind, body: next.body },
        parent: previous ? toRef(previous) : null,
        root: first && first.id !== next.id ? toRef(first) : null,
        checkpoint,
        retriesSoFar: post.attemptCount,
        channel: {
          id: channel.id,
          targetType: channel.targetType,
          externalTargetId: channel.externalTargetId,
        },
        account: { id: account.id, externalAccountId: account.externalAccountId },
        attemptId: attempt.id,
      },
    };
  });
}

/** What the step decided; mirrors StepDecision in @queuesprout/core/publishing. */
export type StepResult =
  | { type: 'item_done'; externalId: string; url: string; meta: Record<string, unknown> }
  | {
      type: 'pending';
      checkpoint: PublishCheckpoint;
      nextCheckAt: Date;
      deadlineAt: Date;
    }
  | { type: 'retry'; runAt: Date; errorKind: PublishErrorKind; message: string }
  | { type: 'fail'; errorKind: PublishErrorKind; message: string; needsReauth: boolean };

export interface FinishStepInput {
  work: StepWork;
  result: StepResult;
  outcome: AttemptOutcome;
  now: Date;
  /** Redacted platform response for the attempt row. */
  response?: unknown;
  httpStatus?: number | null;
}

/** What the job runner should do next. */
export type FollowUp = { next: 'none' } | { next: 'now' } | { next: 'at'; at: Date };

/** Writes a step's result, closes its attempt row and says what runs next. */
export async function finishStep(db: Database, input: FinishStepInput): Promise<FollowUp> {
  const { work, result, now } = input;
  return db.transaction(async (tx) => {
    await tx
      .update(publishAttempts)
      .set({
        finishedAt: now,
        outcome: input.outcome,
        errorKind: result.type === 'retry' || result.type === 'fail' ? result.errorKind : null,
        httpStatus: input.httpStatus ?? null,
        responseRedacted: input.response ?? null,
        stage: result.type === 'pending' ? result.checkpoint.stage : undefined,
      })
      .where(eq(publishAttempts.id, work.attemptId));

    switch (result.type) {
      case 'item_done': {
        await tx
          .update(postItems)
          .set({
            status: 'published',
            externalId: result.externalId,
            externalUrl: result.url,
            externalMeta: result.meta,
            publishedAt: now,
            errorMessage: null,
          })
          .where(eq(postItems.id, work.item.id));
        const more = work.items.some((i) => i.position > work.item.position);
        await tx
          .update(posts)
          .set({
            status: more ? 'publishing' : 'published',
            ...(work.item.position === 0 && {
              externalId: result.externalId,
              externalUrl: result.url,
            }),
            ...(!more && { publishedAt: now }),
            publishCheckpoint: null,
            externalContainerId: null,
            nextCheckAt: null,
            processingDeadlineAt: null,
            errorKind: null,
            errorMessage: null,
            attemptCount: 0,
          })
          .where(eq(posts.id, work.postId));
        return more ? { next: 'now' } : { next: 'none' };
      }
      case 'pending': {
        await tx
          .update(posts)
          .set({
            status: 'processing',
            publishCheckpoint: { ...result.checkpoint, position: work.item.position },
            externalContainerId: result.checkpoint.containerId ?? null,
            nextCheckAt: result.nextCheckAt,
            processingDeadlineAt: result.deadlineAt,
          })
          .where(eq(posts.id, work.postId));
        return { next: 'none' };
      }
      case 'retry': {
        await tx
          .update(posts)
          .set({
            status: 'publishing',
            nextCheckAt: null,
            errorKind: result.errorKind,
            errorMessage: result.message,
            attemptCount: sql`${posts.attemptCount} + 1`,
          })
          .where(eq(posts.id, work.postId));
        return { next: 'at', at: result.runAt };
      }
      case 'fail': {
        await failPost(tx, work.postId, work.item.id, result.errorKind, result.message);
        if (result.needsReauth) {
          await tx
            .update(connectedAccounts)
            .set({ status: 'needs_reauth' })
            .where(eq(connectedAccounts.id, work.account.id));
        }
        return { next: 'none' };
      }
    }
  });
}
