import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { ProviderId, PublishErrorKind } from '@queuesprout/shared';
import type { Database } from '../client';
import { user } from '../schema/auth';
import { channels } from '../schema/accounts';
import { postGroups, postItems, posts } from '../schema/posts';
import { workspaceMembers, workspaces } from '../schema/workspaces';

/**
 * Failure emails (worker only, exported through "@queuesprout/db/publishing"). A sweep
 * finds failed posts nobody was told about, and sends one email per post group once the
 * group has been quiet for a moment, so channels that fail together share one email.
 */

export interface FailureNotice {
  groupId: string;
  /** Stable for one round of failures, so a resend after a crash is deduplicated. */
  idempotencyKey: string;
  workspace: { name: string; slug: string };
  recipients: { email: string; name: string }[];
  /** Item 0 of the base thread, for recognising the post. */
  excerpt: string;
  failures: {
    channel: string;
    provider: ProviderId;
    errorKind: PublishErrorKind | null;
    errorMessage: string | null;
  }[];
}

const unnotified = (settledBefore: Date) =>
  and(
    eq(posts.status, 'failed'),
    isNull(posts.failureNotifiedAt),
    isNull(posts.deletedAt),
    lt(posts.updatedAt, settledBefore),
  );

/** Groups with failed posts that have not been emailed about and changed before the cutoff. */
export async function listUnnotifiedFailureGroups(
  db: Database,
  settledBefore: Date,
  limit = 50,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ groupId: posts.groupId })
    .from(posts)
    .where(unnotified(settledBefore))
    .limit(limit);
  return rows.map((r) => r.groupId);
}

export type NotifyResult = 'sent' | 'none' | 'skipped_sandbox' | 'no_recipients';

/**
 * Locks the group's unnotified failed posts, builds the notice, calls send(), then marks
 * the posts notified in the same transaction. If send() throws, nothing is marked and the
 * next sweep tries again. SKIP LOCKED keeps two sweeps from sending the same email.
 */
export async function notifyFailureGroup(
  db: Database,
  groupId: string,
  settledBefore: Date,
  send: (notice: FailureNotice) => Promise<void>,
): Promise<NotifyResult> {
  return db.transaction(async (tx) => {
    const failed = await tx
      .select({
        id: posts.id,
        updatedAt: posts.updatedAt,
        errorKind: posts.errorKind,
        errorMessage: posts.errorMessage,
        channel: channels.name,
        provider: channels.provider,
      })
      .from(posts)
      .innerJoin(channels, eq(channels.id, posts.channelId))
      .where(and(eq(posts.groupId, groupId), unnotified(settledBefore)))
      .orderBy(asc(channels.provider), asc(channels.name))
      .for('update', { of: posts, skipLocked: true });
    if (failed.length === 0) return 'none';

    const markNotified = () =>
      tx
        .update(posts)
        .set({ failureNotifiedAt: sql`now()` })
        .where(
          inArray(
            posts.id,
            failed.map((f) => f.id),
          ),
        );

    const [group] = await tx
      .select({
        createdBy: postGroups.createdBy,
        baseBody: postGroups.baseBody,
        workspaceId: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        isSandbox: workspaces.isSandbox,
      })
      .from(postGroups)
      .innerJoin(workspaces, eq(workspaces.id, postGroups.workspaceId))
      .where(eq(postGroups.id, groupId));
    if (!group) return 'none';
    if (group.isSandbox) {
      // Sandbox posts never leave QueueSprout; their failures are rehearsals.
      await markNotified();
      return 'skipped_sandbox';
    }

    // The author while they can still act on it, otherwise the workspace's admins.
    const members = await tx
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        email: user.email,
        name: user.name,
      })
      .from(workspaceMembers)
      .innerJoin(user, eq(user.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, group.workspaceId));
    const author = members.find((m) => m.userId === group.createdBy && m.role !== 'viewer');
    const recipients = (
      author ? [author] : members.filter((m) => m.role === 'owner' || m.role === 'admin')
    ).map((m) => ({ email: m.email, name: m.name }));
    if (recipients.length === 0) {
      await markNotified();
      return 'no_recipients';
    }

    let excerpt = group.baseBody;
    if (!excerpt) {
      const [first] = await tx
        .select({ body: postItems.body })
        .from(postItems)
        .where(and(eq(postItems.postId, failed[0]?.id ?? ''), eq(postItems.position, 0)));
      excerpt = first?.body ?? '';
    }

    const latest = Math.max(...failed.map((f) => f.updatedAt.getTime()));
    await send({
      groupId,
      idempotencyKey: `post-failed/${groupId}/${latest}`,
      workspace: { name: group.name, slug: group.slug },
      recipients,
      excerpt,
      failures: failed.map(({ channel, provider, errorKind, errorMessage }) => ({
        channel,
        provider,
        errorKind,
        errorMessage,
      })),
    });
    await markNotified();
    return 'sent';
  });
}
