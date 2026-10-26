import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PublishErrorKind } from '@queuesprout/shared';
import { createDataAccess, type DataAccess, type WorkspaceContext } from './context';
import { connectAccount, upsertChannel } from './queries/accounts';
import { getPublishHistory, retryPost } from './queries/history';
import { getPostGroup, savePostGroup } from './queries/posts';
import { createWorkspace } from './queries/workspaces';
import {
  connectedAccounts,
  postGroups,
  postItems,
  posts,
  publishAttempts,
  user,
  workspaceMembers,
} from './schema';
import { createTestDatabase, type TestDatabase } from './test-utils';

describe('post page: publish history and retry', () => {
  let t: TestDatabase;
  let da: DataAccess;
  const alice = { id: randomUUID(), email: 'alice@example.com', name: 'Alice' };
  const ed = { id: randomUUID(), email: 'ed@example.com', name: 'Ed' };
  const vic = { id: randomUUID(), email: 'vic@example.com', name: 'Vic' };
  const eve = { id: randomUUID(), email: 'eve@example.com', name: 'Eve' };
  let asEd: WorkspaceContext;
  let asVic: WorkspaceContext;
  let asEve: WorkspaceContext;
  let workspaceId: string;
  let accountId: string;
  let channelId: string;

  const ctx = async (userId: string, slug: string) => {
    const c = await da.resolveWorkspace(userId, slug);
    if (!c) throw new Error(`${userId} is not a member of ${slug}`);
    return c;
  };

  /** A thread whose item 0 went out and item 1 failed, written as the worker would. */
  async function failedThread(errorKind: PublishErrorKind = 'transient') {
    const [group] = await t.owner.insert(postGroups).values({ workspaceId }).returning();
    if (!group) throw new Error('no group');
    const [post] = await t.owner
      .insert(posts)
      .values({
        workspaceId,
        groupId: group.id,
        channelId,
        status: 'failed',
        scheduledAt: new Date('2026-10-26T09:00:00Z'),
        externalId: 'ext-0',
        externalUrl: 'https://example.social/0',
        errorKind,
        errorMessage: 'Platform error (503). Gave up after 5 retries.',
        attemptCount: 5,
      })
      .returning();
    if (!post) throw new Error('no post');
    const items = await t.owner
      .insert(postItems)
      .values([
        {
          workspaceId,
          postId: post.id,
          position: 0,
          body: 'one',
          status: 'published' as const,
          externalId: 'ext-0',
          externalUrl: 'https://example.social/0',
          publishedAt: new Date('2026-10-26T09:00:01Z'),
        },
        {
          workspaceId,
          postId: post.id,
          position: 1,
          kind: 'reply' as const,
          body: 'two',
          status: 'failed' as const,
          errorMessage: 'Platform error (503).',
        },
        { workspaceId, postId: post.id, position: 2, kind: 'reply' as const, body: 'three' },
      ])
      .returning();
    await t.owner.insert(publishAttempts).values([
      {
        workspaceId,
        postId: post.id,
        postItemId: items[0]?.id,
        attemptNo: 1,
        startedAt: new Date('2026-10-26T09:00:00Z'),
        finishedAt: new Date('2026-10-26T09:00:01Z'),
        outcome: 'success' as const,
      },
      {
        workspaceId,
        postId: post.id,
        postItemId: items[1]?.id,
        attemptNo: 2,
        startedAt: new Date('2026-10-26T09:00:02Z'),
        finishedAt: new Date('2026-10-26T09:00:03Z'),
        outcome: 'fatal_error' as const,
        errorKind,
        httpStatus: 503,
      },
    ]);
    return post.id;
  }

  const getPost = async (id: string) => {
    const [row] = await t.owner.select().from(posts).where(eq(posts.id, id));
    if (!row) throw new Error('missing');
    return row;
  };
  const itemStatuses = async (id: string) =>
    (
      await t.owner
        .select({ status: postItems.status })
        .from(postItems)
        .where(eq(postItems.postId, id))
        .orderBy(asc(postItems.position))
    ).map((i) => i.status);

  const retry = (c: WorkspaceContext, id: string, confirm = false) =>
    da.withWorkspace(c, (tx) => retryPost(tx, id, confirm));

  beforeAll(async () => {
    t = await createTestDatabase();
    da = createDataAccess(t.web);
    await t.web.insert(user).values([alice, ed, vic, eve]);
    await da.withUser(alice.id, (tx) =>
      createWorkspace(tx, { name: 'Acme', slug: 'acme', timezone: 'UTC' }),
    );
    await da.withUser(eve.id, (tx) =>
      createWorkspace(tx, { name: 'Evil', slug: 'evil', timezone: 'UTC' }),
    );
    const acme = await ctx(alice.id, 'acme');
    workspaceId = acme.workspaceId;
    await t.owner.insert(workspaceMembers).values([
      { workspaceId, userId: ed.id, role: 'editor' },
      { workspaceId, userId: vic.id, role: 'viewer' },
    ]);
    asEd = await ctx(ed.id, 'acme');
    asVic = await ctx(vic.id, 'acme');
    asEve = await ctx(eve.id, 'evil');
    const added = await da.withWorkspace(acme, async (tx) => {
      const account = await connectAccount(tx, {
        workspaceId,
        provider: 'bluesky',
        externalAccountId: 'acme.bsky',
        displayName: 'acme',
        accessTokenEnc: Buffer.from('cipher'),
        keyVersion: 1,
      });
      if (!account.ok) throw new Error('connect failed');
      const channel = await upsertChannel(tx, {
        workspaceId,
        accountId: account.accountId,
        provider: 'bluesky',
        targetType: 'profile',
        externalTargetId: 'acme.bsky',
        name: 'acme',
      });
      return { accountId: account.accountId, channelId: channel.id };
    });
    accountId = added.accountId;
    channelId = added.channelId;
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('shows viewers each item and the attempts, newest first', async () => {
    const id = await failedThread();
    const history = await da.withWorkspace(asVic, (tx) => getPublishHistory(tx, workspaceId, [id]));
    const h = history.get(id);
    expect(h?.errorKind).toBe('transient');
    expect(h?.items.map((i) => [i.position, i.status])).toEqual([
      [0, 'published'],
      [1, 'failed'],
      [2, 'pending'],
    ]);
    expect(h?.attempts.map((a) => [a.attemptNo, a.position, a.outcome, a.httpStatus])).toEqual([
      [2, 1, 'fatal_error', 503],
      [1, 0, 'success', null],
    ]);
    expect(h?.attemptTotal).toBe(2);
  });

  it('shows nothing from another workspace', async () => {
    const id = await failedThread();
    const history = await da.withWorkspace(asEve, (tx) =>
      getPublishHistory(tx, asEve.workspaceId, [id]),
    );
    expect(history.size).toBe(0);
  });

  it('retries a failed post from the item that failed, keeping what is out', async () => {
    const id = await failedThread();
    const before = Date.now();
    expect(await retry(asEd, id)).toEqual({ ok: true });
    const post = await getPost(id);
    expect(post).toMatchObject({
      status: 'scheduled',
      errorKind: null,
      errorMessage: null,
      attemptCount: 0,
      externalId: 'ext-0',
    });
    expect(post.scheduledAt?.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(await itemStatuses(id)).toEqual(['published', 'pending', 'pending']);
  });

  it('only retries failed posts, and only for editors of the workspace', async () => {
    const id = await failedThread();
    expect(await retry(asVic, id)).toEqual({ ok: false, error: 'forbidden' });
    expect(await retry(asEve, id)).toEqual({ ok: false, error: 'not_found' });
    expect(await retry(asEd, id)).toEqual({ ok: true });
    expect(await retry(asEd, id)).toEqual({ ok: false, error: 'not_failed' });
    expect(await retry(asEd, randomUUID())).toEqual({ ok: false, error: 'not_found' });
  });

  it('asks for confirmation when the post may already be on the platform', async () => {
    const id = await failedThread('unknown');
    expect(await retry(asEd, id)).toEqual({ ok: false, error: 'confirm_required' });
    expect((await getPost(id)).status).toBe('failed');
    expect(await retry(asEd, id, true)).toEqual({ ok: true });
  });

  it('refuses while the account needs reconnecting', async () => {
    const id = await failedThread('auth');
    await t.owner
      .update(connectedAccounts)
      .set({ status: 'needs_reauth' })
      .where(eq(connectedAccounts.id, accountId));
    try {
      expect(await retry(asEd, id)).toEqual({ ok: false, error: 'account_needs_reauth' });
      expect(await itemStatuses(id)).toEqual(['published', 'failed', 'pending']);
    } finally {
      await t.owner
        .update(connectedAccounts)
        .set({ status: 'active' })
        .where(eq(connectedAccounts.id, accountId));
    }
  });

  it('keeps the caller’s transaction usable after a refusal', async () => {
    const id = await failedThread('unknown');
    const after = await da.withWorkspace(asEd, async (tx) => {
      const refused = await retryPost(tx, id, false);
      const history = await getPublishHistory(tx, workspaceId, [id]);
      return { refused, seen: history.has(id) };
    });
    expect(after).toEqual({ refused: { ok: false, error: 'confirm_required' }, seen: true });
  });

  it('still keeps item results worker-only', async () => {
    const id = await failedThread();
    await expect(
      da.withWorkspace(asEd, (tx) =>
        tx.update(postItems).set({ status: 'pending' }).where(eq(postItems.postId, id)),
      ),
    ).rejects.toThrow();
  });

  it('never lets a retried thread be rewritten, so its sent parts are not sent again', async () => {
    const id = await failedThread();
    expect(await retry(asEd, id)).toEqual({ ok: true });
    const post = await getPost(id);

    const group = await da.withWorkspace(asEd, (tx) => getPostGroup(tx, workspaceId, post.groupId));
    expect(group?.posts[0]).toMatchObject({ status: 'scheduled', sentItems: 1 });

    const saved = await da.withWorkspace(asEd, (tx) =>
      savePostGroup(tx, {
        workspaceId,
        userId: ed.id,
        groupId: post.groupId,
        baseItems: ['one, edited', 'two', 'three'],
        channels: [{ channelId, items: ['one, edited', 'two', 'three'], version: post.version }],
        status: 'scheduled',
        scheduledAt: new Date(),
      }),
    );
    expect(saved).toEqual({ ok: false, error: 'locked', channelIds: [channelId] });

    // And the database refuses it even without the query's check.
    await expect(
      da.withWorkspace(asEd, (tx) => tx.delete(postItems).where(eq(postItems.postId, id))),
    ).rejects.toThrow();
    await expect(
      da.withWorkspace(asEd, (tx) =>
        tx.update(postItems).set({ body: 'rewritten' }).where(eq(postItems.postId, id)),
      ),
    ).rejects.toThrow();
    expect(await itemStatuses(id)).toEqual(['published', 'pending', 'pending']);
  });
});
