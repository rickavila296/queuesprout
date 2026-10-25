import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { PostStatus, ProviderId } from '@queuesprout/shared';
import type { Tx } from '../client';
import { channels, connectedAccounts } from '../schema/accounts';
import { postGroups, postItems, posts } from '../schema/posts';

/**
 * Composer and calendar queries for apps/web. Run them inside withWorkspace(): RLS
 * checks the role, and the guard triggers keep users off worker-only statuses and
 * in-flight posts.
 */

/** Statuses the composer may change. Failed posts are retried from the post page instead. */
export const COMPOSER_EDITABLE = [
  'draft',
  'scheduled',
  'cancelled',
] as const satisfies readonly PostStatus[];
const isComposerEditable = (s: PostStatus) => (COMPOSER_EDITABLE as readonly string[]).includes(s);

export interface SavePostGroupInput {
  workspaceId: string;
  userId: string;
  /** Absent to create a new group. */
  groupId?: string;
  /** Base thread: item 0, then replies. */
  baseItems: string[];
  /** Each picked channel with the thread it publishes and, for existing posts, its version. */
  channels: { channelId: string; items: string[]; version?: number }[];
  status: 'draft' | 'scheduled';
  scheduledAt: Date | null;
}

export type SavePostGroupResult =
  | { ok: true; groupId: string; postIds: string[] }
  | {
      ok: false;
      error: 'not_found' | 'conflict' | 'locked' | 'channel_unavailable';
      /** Channels the error is about. */
      channelIds?: string[];
    };

/**
 * Creates or updates a compose group: one post per channel, each with its thread.
 * Every row it changes is locked first and every check runs before the first write,
 * so a failed check leaves nothing behind. A post the dispatcher claimed in the
 * meantime comes back as locked; one edited elsewhere comes back as a conflict.
 */
export async function savePostGroup(
  tx: Tx,
  input: SavePostGroupInput,
): Promise<SavePostGroupResult> {
  const channelIds = input.channels.map((c) => c.channelId);
  const [first, ...replies] = input.baseItems;
  if (first === undefined) throw new Error('baseItems needs at least one item');

  const found = await tx
    .select({
      id: channels.id,
      channelStatus: channels.status,
      accountStatus: connectedAccounts.status,
    })
    .from(channels)
    .innerJoin(
      connectedAccounts,
      and(
        eq(connectedAccounts.id, channels.accountId),
        eq(connectedAccounts.workspaceId, channels.workspaceId),
      ),
    )
    .where(and(eq(channels.workspaceId, input.workspaceId), inArray(channels.id, channelIds)));
  const unavailable = channelIds.filter((id) => {
    const c = found.find((f) => f.id === id);
    if (!c) return true;
    return (
      input.status === 'scheduled' &&
      (c.channelStatus === 'disabled' || c.accountStatus !== 'active')
    );
  });
  if (unavailable.length > 0) {
    return { ok: false, error: 'channel_unavailable', channelIds: unavailable };
  }

  let groupId = input.groupId;
  let existing: { id: string; channelId: string; status: PostStatus; version: number }[] = [];
  if (groupId) {
    const group = await tx
      .select({ id: postGroups.id })
      .from(postGroups)
      .where(and(eq(postGroups.id, groupId), eq(postGroups.workspaceId, input.workspaceId)))
      .for('update');
    if (group.length === 0) return { ok: false, error: 'not_found' };
    existing = await tx
      .select({
        id: posts.id,
        channelId: posts.channelId,
        status: posts.status,
        version: posts.version,
      })
      .from(posts)
      .where(and(eq(posts.groupId, groupId), isNull(posts.deletedAt)))
      // Waits for a dispatcher claim in progress, then sees the claimed status.
      .for('update');
  }

  const byChannel = new Map(existing.map((p) => [p.channelId, p]));
  const locked: string[] = [];
  const conflicts: string[] = [];
  for (const c of input.channels) {
    const post = byChannel.get(c.channelId);
    if (!post) {
      if (c.version !== undefined) conflicts.push(c.channelId); // it was deleted elsewhere
      continue;
    }
    if (!isComposerEditable(post.status)) locked.push(c.channelId);
    else if (c.version !== post.version) conflicts.push(c.channelId);
  }
  if (locked.length > 0) return { ok: false, error: 'locked', channelIds: locked };
  if (conflicts.length > 0) return { ok: false, error: 'conflict', channelIds: conflicts };

  if (groupId) {
    await tx
      .update(postGroups)
      .set({ baseBody: first, baseReplies: replies })
      .where(eq(postGroups.id, groupId));
  } else {
    const rows = await tx
      .insert(postGroups)
      .values({
        workspaceId: input.workspaceId,
        createdBy: input.userId,
        baseBody: first,
        baseReplies: replies,
      })
      .returning({ id: postGroups.id });
    groupId = rows[0]?.id;
    if (!groupId) throw new Error('post_groups insert returned no id');
  }

  // Channels dropped from the composer: soft-delete their editable posts.
  const dropped = existing.filter(
    (p) => !channelIds.includes(p.channelId) && isComposerEditable(p.status),
  );
  if (dropped.length > 0) {
    await tx
      .update(posts)
      .set({ deletedAt: sql`now()` })
      .where(
        inArray(
          posts.id,
          dropped.map((p) => p.id),
        ),
      );
  }

  const postIds: string[] = [];
  for (const c of input.channels) {
    const prior = byChannel.get(c.channelId);
    let postId: string;
    if (prior) {
      postId = prior.id;
      await tx
        .update(posts)
        .set({
          status: input.status,
          scheduledAt: input.scheduledAt,
          errorKind: null,
          errorMessage: null,
        })
        .where(eq(posts.id, postId));
      await tx.delete(postItems).where(eq(postItems.postId, postId));
    } else {
      const rows = await tx
        .insert(posts)
        .values({
          workspaceId: input.workspaceId,
          groupId,
          channelId: c.channelId,
          status: input.status,
          scheduledAt: input.scheduledAt,
        })
        .returning({ id: posts.id });
      const id = rows[0]?.id;
      if (!id) throw new Error('posts insert returned no id');
      postId = id;
    }
    await tx.insert(postItems).values(
      c.items.map((body, position) => ({
        workspaceId: input.workspaceId,
        postId,
        position,
        kind: position === 0 ? ('post' as const) : ('reply' as const),
        body,
      })),
    );
    postIds.push(postId);
  }
  return { ok: true, groupId, postIds };
}

export interface GroupPost {
  id: string;
  channelId: string;
  status: PostStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  externalUrl: string | null;
  errorMessage: string | null;
  version: number;
  items: string[];
}

export interface PostGroupDetail {
  id: string;
  baseItems: string[];
  createdAt: Date;
  posts: GroupPost[];
}

/** A group with its live (not deleted) posts and their threads, for the composer. */
export async function getPostGroup(
  tx: Tx,
  workspaceId: string,
  groupId: string,
): Promise<PostGroupDetail | null> {
  const groups = await tx
    .select()
    .from(postGroups)
    .where(and(eq(postGroups.id, groupId), eq(postGroups.workspaceId, workspaceId)))
    .limit(1);
  const group = groups[0];
  if (!group) return null;

  const rows = await tx
    .select({
      id: posts.id,
      channelId: posts.channelId,
      status: posts.status,
      scheduledAt: posts.scheduledAt,
      publishedAt: posts.publishedAt,
      externalUrl: posts.externalUrl,
      errorMessage: posts.errorMessage,
      version: posts.version,
    })
    .from(posts)
    .where(and(eq(posts.groupId, groupId), isNull(posts.deletedAt)))
    .orderBy(asc(posts.createdAt));
  const items =
    rows.length === 0
      ? []
      : await tx
          .select({ postId: postItems.postId, position: postItems.position, body: postItems.body })
          .from(postItems)
          .where(
            inArray(
              postItems.postId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(asc(postItems.postId), asc(postItems.position));

  return {
    id: group.id,
    baseItems: [group.baseBody, ...group.baseReplies],
    createdAt: group.createdAt,
    posts: rows.map((r) => ({
      ...r,
      items: items.filter((i) => i.postId === r.id).map((i) => i.body),
    })),
  };
}

/** Soft-deletes the group's editable posts. Published and in-flight posts stay. */
export async function deletePostGroup(
  tx: Tx,
  workspaceId: string,
  groupId: string,
): Promise<{ deleted: number; kept: number }> {
  const live = await tx
    .select({ id: posts.id, status: posts.status })
    .from(posts)
    .where(
      and(eq(posts.groupId, groupId), eq(posts.workspaceId, workspaceId), isNull(posts.deletedAt)),
    )
    .for('update');
  const deletable = live.filter((p) => isComposerEditable(p.status) || p.status === 'failed');
  if (deletable.length > 0) {
    await tx
      .update(posts)
      .set({ deletedAt: sql`now()` })
      .where(
        inArray(
          posts.id,
          deletable.map((p) => p.id),
        ),
      );
  }
  const total = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(posts)
    .where(and(eq(posts.groupId, groupId), isNull(posts.deletedAt)));
  return { deleted: deletable.length, kept: total[0]?.n ?? 0 };
}

export interface CalendarPost {
  id: string;
  groupId: string;
  status: PostStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  externalUrl: string | null;
  errorMessage: string | null;
  channelId: string;
  channelName: string;
  provider: ProviderId;
  /** Item 0's text. */
  body: string;
  itemCount: number;
}

const calendarColumns = {
  id: posts.id,
  groupId: posts.groupId,
  status: posts.status,
  scheduledAt: posts.scheduledAt,
  publishedAt: posts.publishedAt,
  externalUrl: posts.externalUrl,
  errorMessage: posts.errorMessage,
  channelId: posts.channelId,
  channelName: channels.name,
  provider: channels.provider,
  body: sql<string>`coalesce((select pi.body from post_items pi where pi.post_id = ${posts.id} and pi.position = 0), '')`,
  itemCount: sql<number>`(select count(*)::int from post_items pi where pi.post_id = ${posts.id})`,
};

/** Posts scheduled in [from, to), oldest first. */
export async function listCalendarPosts(
  tx: Tx,
  workspaceId: string,
  range: { from: Date; to: Date; limit?: number },
): Promise<CalendarPost[]> {
  return tx
    .select(calendarColumns)
    .from(posts)
    .innerJoin(
      channels,
      and(eq(channels.id, posts.channelId), eq(channels.workspaceId, posts.workspaceId)),
    )
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        isNull(posts.deletedAt),
        gte(posts.scheduledAt, range.from),
        lt(posts.scheduledAt, range.to),
      ),
    )
    .orderBy(asc(posts.scheduledAt), asc(channels.name))
    .limit(range.limit ?? 500);
}

/** Drafts with no time yet, newest first. */
export async function listUnscheduledDrafts(
  tx: Tx,
  workspaceId: string,
  limit = 100,
): Promise<CalendarPost[]> {
  return tx
    .select(calendarColumns)
    .from(posts)
    .innerJoin(
      channels,
      and(eq(channels.id, posts.channelId), eq(channels.workspaceId, posts.workspaceId)),
    )
    .where(
      and(eq(posts.workspaceId, workspaceId), isNull(posts.deletedAt), isNull(posts.scheduledAt)),
    )
    .orderBy(sql`${posts.updatedAt} desc`)
    .limit(limit);
}
