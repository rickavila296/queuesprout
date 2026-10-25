import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDataAccess, type DataAccess, type WorkspaceContext } from './context';
import { connectAccount, listChannels, removeChannel, upsertChannel } from './queries/accounts';
import {
  deletePostGroup,
  getPostGroup,
  listCalendarPosts,
  listUnscheduledDrafts,
  savePostGroup,
  type SavePostGroupInput,
} from './queries/posts';
import { createWorkspace } from './queries/workspaces';
import { connectedAccounts, postItems, posts, user, workspaceMembers } from './schema';
import { accountCredentials } from './schema/credentials';
import { createTestDatabase, type TestDatabase } from './test-utils';

describe('composer queries', () => {
  let t: TestDatabase;
  let da: DataAccess;
  const alice = { id: randomUUID(), email: 'alice@example.com', name: 'Alice' };
  const ed = { id: randomUUID(), email: 'ed@example.com', name: 'Ed' };
  const vic = { id: randomUUID(), email: 'vic@example.com', name: 'Vic' };
  const eve = { id: randomUUID(), email: 'eve@example.com', name: 'Eve' };
  let asEd: WorkspaceContext;
  let asVic: WorkspaceContext;
  let bsky: string;
  let masto: string;
  let mastoAccount: string;
  let evilChannel: string;
  const at = new Date('2026-11-02T15:00:00Z');

  const ctx = async (userId: string, slug: string) => {
    const c = await da.resolveWorkspace(userId, slug);
    if (!c) throw new Error(`${userId} is not a member of ${slug}`);
    return c;
  };

  const addChannel = async (c: WorkspaceContext, provider: 'bluesky' | 'mastodon', id: string) => {
    return da.withWorkspace(c, async (tx) => {
      const account = await connectAccount(tx, {
        workspaceId: c.workspaceId,
        provider,
        externalAccountId: id,
        displayName: id,
        accessTokenEnc: Buffer.from('cipher'),
        keyVersion: 1,
      });
      if (!account.ok) throw new Error('connect failed');
      const channel = await upsertChannel(tx, {
        workspaceId: c.workspaceId,
        accountId: account.accountId,
        provider,
        targetType: 'profile',
        externalTargetId: id,
        name: id,
      });
      return { accountId: account.accountId, channelId: channel.id };
    });
  };

  const save = (c: WorkspaceContext, input: Omit<SavePostGroupInput, 'workspaceId' | 'userId'>) =>
    da.withWorkspace(c, (tx) =>
      savePostGroup(tx, { ...input, workspaceId: c.workspaceId, userId: c.userId }),
    );
  /** Posts in a group are created in one transaction, so sort them by channel for asserts. */
  const order = () => [bsky, masto, evilChannel];
  const load = async (c: WorkspaceContext, groupId: string) => {
    const group = await da.withWorkspace(c, (tx) => getPostGroup(tx, c.workspaceId, groupId));
    group?.posts.sort((a, b) => order().indexOf(a.channelId) - order().indexOf(b.channelId));
    return group;
  };

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
    await t.owner.insert(workspaceMembers).values([
      { workspaceId: acme.workspaceId, userId: ed.id, role: 'editor' },
      { workspaceId: acme.workspaceId, userId: vic.id, role: 'viewer' },
    ]);
    asEd = await ctx(ed.id, 'acme');
    asVic = await ctx(vic.id, 'acme');
    bsky = (await addChannel(acme, 'bluesky', 'acme.bsky')).channelId;
    const m = await addChannel(acme, 'mastodon', 'acme@mastodon');
    masto = m.channelId;
    mastoAccount = m.accountId;
    evilChannel = (await addChannel(await ctx(eve.id, 'evil'), 'bluesky', 'evil.bsky')).channelId;
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('creates one post per channel, with overrides', async () => {
    const result = await save(asEd, {
      baseItems: ['Launch day', 'Details in the thread'],
      channels: [
        { channelId: bsky, items: ['Launch day', 'Details in the thread'] },
        { channelId: masto, items: ['Launch day on Mastodon'] },
      ],
      status: 'scheduled',
      scheduledAt: at,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const group = await load(asVic, result.groupId);
    expect(group?.baseItems).toEqual(['Launch day', 'Details in the thread']);
    expect(group?.posts.map((p) => [p.channelId, p.status, p.items])).toEqual([
      [bsky, 'scheduled', ['Launch day', 'Details in the thread']],
      [masto, 'scheduled', ['Launch day on Mastodon']],
    ]);
    const kinds = await t.owner
      .select({ kind: postItems.kind })
      .from(postItems)
      .where(eq(postItems.postId, result.postIds[0] ?? ''))
      .orderBy(postItems.position);
    expect(kinds.map((k) => k.kind)).toEqual(['post', 'reply']);
  });

  it('updates in place, drops removed channels and rejects stale versions', async () => {
    const created = await save(asEd, {
      baseItems: ['v1'],
      channels: [
        { channelId: bsky, items: ['v1'] },
        { channelId: masto, items: ['v1'] },
      ],
      status: 'draft',
      scheduledAt: null,
    });
    if (!created.ok) throw new Error('create failed');
    const loaded = await load(asEd, created.groupId);
    const bskyPost = loaded?.posts.find((p) => p.channelId === bsky);
    if (!bskyPost) throw new Error('missing post');

    const updated = await save(asEd, {
      groupId: created.groupId,
      baseItems: ['v2'],
      channels: [{ channelId: bsky, items: ['v2'], version: bskyPost.version }],
      status: 'scheduled',
      scheduledAt: at,
    });
    expect(updated).toMatchObject({ ok: true, postIds: [bskyPost.id] });

    const after = await load(asEd, created.groupId);
    expect(after?.baseItems).toEqual(['v2']);
    expect(after?.posts.map((p) => [p.channelId, p.status, p.items])).toEqual([
      [bsky, 'scheduled', ['v2']],
    ]);

    // Same version again: the update above bumped it, so this save is stale.
    const stale = await save(asEd, {
      groupId: created.groupId,
      baseItems: ['v3'],
      channels: [{ channelId: bsky, items: ['v3'], version: bskyPost.version }],
      status: 'draft',
      scheduledAt: null,
    });
    expect(stale).toEqual({ ok: false, error: 'conflict', channelIds: [bsky] });
    expect((await load(asEd, created.groupId))?.posts[0]?.items).toEqual(['v2']);

    // A version for a post that no longer exists means someone removed it meanwhile.
    const gone = await save(asEd, {
      groupId: created.groupId,
      baseItems: ['v3'],
      channels: [{ channelId: masto, items: ['v3'], version: 1 }],
      status: 'draft',
      scheduledAt: null,
    });
    expect(gone).toEqual({ ok: false, error: 'conflict', channelIds: [masto] });
  });

  it('refuses to edit a post the worker has claimed, and keeps it when dropped', async () => {
    const created = await save(asEd, {
      baseItems: ['claimed'],
      channels: [
        { channelId: bsky, items: ['claimed'] },
        { channelId: masto, items: ['claimed'] },
      ],
      status: 'scheduled',
      scheduledAt: at,
    });
    if (!created.ok) throw new Error('create failed');
    const [bskyId] = created.postIds;
    await t.owner
      .update(posts)
      .set({ status: 'queued' })
      .where(eq(posts.id, bskyId ?? ''));
    const group = await load(asEd, created.groupId);
    const version = (id: string) => group?.posts.find((p) => p.channelId === id)?.version;

    const edit = await save(asEd, {
      groupId: created.groupId,
      baseItems: ['edited'],
      channels: [{ channelId: bsky, items: ['edited'], version: version(bsky) }],
      status: 'scheduled',
      scheduledAt: at,
    });
    expect(edit).toEqual({ ok: false, error: 'locked', channelIds: [bsky] });

    const dropBsky = await save(asEd, {
      groupId: created.groupId,
      baseItems: ['edited'],
      channels: [{ channelId: masto, items: ['edited'], version: version(masto) }],
      status: 'scheduled',
      scheduledAt: at,
    });
    expect(dropBsky.ok).toBe(true);
    const after = await load(asEd, created.groupId);
    expect(after?.posts.map((p) => [p.channelId, p.status, p.items])).toEqual([
      [bsky, 'queued', ['claimed']],
      [masto, 'scheduled', ['edited']],
    ]);
  });

  it('only schedules to channels in the workspace that can publish', async () => {
    const foreign = await save(asEd, {
      baseItems: ['x'],
      channels: [{ channelId: evilChannel, items: ['x'] }],
      status: 'draft',
      scheduledAt: null,
    });
    expect(foreign).toEqual({ ok: false, error: 'channel_unavailable', channelIds: [evilChannel] });

    await t.owner
      .update(connectedAccounts)
      .set({ status: 'needs_reauth' })
      .where(eq(connectedAccounts.id, mastoAccount));
    const scheduled = await save(asEd, {
      baseItems: ['x'],
      channels: [{ channelId: masto, items: ['x'] }],
      status: 'scheduled',
      scheduledAt: at,
    });
    expect(scheduled).toEqual({ ok: false, error: 'channel_unavailable', channelIds: [masto] });
    const draft = await save(asEd, {
      baseItems: ['x'],
      channels: [{ channelId: masto, items: ['x'] }],
      status: 'draft',
      scheduledAt: null,
    });
    expect(draft.ok).toBe(true);
    await t.owner
      .update(connectedAccounts)
      .set({ status: 'active' })
      .where(eq(connectedAccounts.id, mastoAccount));
  });

  it('does not let viewers save', async () => {
    await expect(
      save(asVic, {
        baseItems: ['x'],
        channels: [{ channelId: bsky, items: ['x'] }],
        status: 'draft',
        scheduledAt: null,
      }),
    ).rejects.toThrow();
  });

  it('lists the calendar range and unscheduled drafts', async () => {
    const draft = await save(asEd, {
      baseItems: ['someday', 'maybe'],
      channels: [{ channelId: bsky, items: ['someday', 'maybe'] }],
      status: 'draft',
      scheduledAt: null,
    });
    if (!draft.ok) throw new Error('draft failed');
    const later = await save(asEd, {
      baseItems: ['next week'],
      channels: [{ channelId: bsky, items: ['next week'] }],
      status: 'scheduled',
      scheduledAt: new Date('2026-11-09T15:00:00Z'),
    });
    if (!later.ok) throw new Error('schedule failed');

    const day = await da.withWorkspace(asVic, (tx) =>
      listCalendarPosts(tx, asVic.workspaceId, {
        from: new Date('2026-11-02T00:00:00Z'),
        to: new Date('2026-11-03T00:00:00Z'),
      }),
    );
    expect(day.length).toBeGreaterThan(0);
    expect(day.every((p) => p.scheduledAt?.getTime() === at.getTime())).toBe(true);
    expect(day.some((p) => p.groupId === later.groupId)).toBe(false);
    expect(day[0]).toMatchObject({ provider: 'bluesky', channelName: 'acme.bsky' });

    const drafts = await da.withWorkspace(asVic, (tx) =>
      listUnscheduledDrafts(tx, asVic.workspaceId),
    );
    expect(drafts[0]).toMatchObject({ groupId: draft.groupId, body: 'someday', itemCount: 2 });
  });

  it('deletes editable posts and keeps published ones', async () => {
    const created = await save(asEd, {
      baseItems: ['bye'],
      channels: [
        { channelId: bsky, items: ['bye'] },
        { channelId: masto, items: ['bye'] },
      ],
      status: 'scheduled',
      scheduledAt: at,
    });
    if (!created.ok) throw new Error('create failed');
    await t.owner
      .update(posts)
      .set({ status: 'published', publishedAt: at })
      .where(eq(posts.id, created.postIds[0] ?? ''));

    const result = await da.withWorkspace(asEd, (tx) =>
      deletePostGroup(tx, asEd.workspaceId, created.groupId),
    );
    expect(result).toEqual({ deleted: 1, kept: 1 });
    expect((await load(asEd, created.groupId))?.posts.map((p) => p.status)).toEqual(['published']);
  });

  it('removes a channel with its posts, and the account with its last channel', async () => {
    const acme = await ctx(alice.id, 'acme');
    const extra = await addChannel(acme, 'bluesky', 'removed.bsky');
    const created = await save(asEd, {
      baseItems: ['gone soon'],
      channels: [{ channelId: extra.channelId, items: ['gone soon'] }],
      status: 'scheduled',
      scheduledAt: at,
    });
    if (!created.ok) throw new Error('create failed');
    await t.owner
      .update(posts)
      .set({ status: 'published', publishedAt: at })
      .where(eq(posts.id, created.postIds[0] ?? ''));

    expect(
      await da.withWorkspace(asEd, (tx) => removeChannel(tx, asEd.workspaceId, extra.channelId)),
    ).toBe(false); // editors cannot see a delete through RLS
    expect(
      await da.withWorkspace(acme, (tx) => removeChannel(tx, acme.workspaceId, extra.channelId)),
    ).toBe(true);

    const channelsLeft = await da.withWorkspace(acme, (tx) => listChannels(tx, acme.workspaceId));
    expect(channelsLeft.some((c) => c.id === extra.channelId)).toBe(false);
    const secrets = await t.owner
      .select()
      .from(accountCredentials)
      .where(eq(accountCredentials.accountId, extra.accountId));
    expect(secrets).toEqual([]);
    expect(await load(acme, created.groupId)).toMatchObject({ posts: [] });
  });
});
