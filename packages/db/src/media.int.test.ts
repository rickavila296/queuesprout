import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WORKSPACE_STORAGE_QUOTA_BYTES } from '@queuesprout/shared';
import { createDataAccess, type DataAccess, type WorkspaceContext } from './context';
import { findPgError } from './errors';
import { connectAccount, upsertChannel } from './queries/accounts';
import {
  confirmMedia,
  deleteMedia,
  getMedia,
  getStorageUsage,
  listMedia,
  reserveMedia,
  type ReserveMediaInput,
} from './queries/media';
import { createWorkspace } from './queries/workspaces';
import {
  mediaAssets,
  postGroups,
  postItemMedia,
  postItems,
  posts,
  user,
  workspaceMembers,
  workspaces,
} from './schema';
import { createTestDatabase, type TestDatabase } from './test-utils';

describe('media uploads', () => {
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
  let channelId: string;

  const ctx = async (userId: string, slug: string) => {
    const c = await da.resolveWorkspace(userId, slug);
    if (!c) throw new Error(`${userId} is not a member of ${slug}`);
    return c;
  };

  const input = (overrides: Partial<ReserveMediaInput> = {}): ReserveMediaInput => {
    const mediaId = overrides.mediaId ?? randomUUID();
    const ws = overrides.workspaceId ?? workspaceId;
    return {
      workspaceId: ws,
      mediaId,
      filename: 'cat.png',
      mime: 'image/png',
      bytes: 1000,
      retention: 'auto',
      storageKey: `ws/${ws}/${mediaId}/original.png`,
      ...overrides,
    };
  };

  const reserve = (c: WorkspaceContext, i: ReserveMediaInput) =>
    da.withWorkspace(c, (tx) => reserveMedia(tx, i));
  const confirm = (c: WorkspaceContext, id: string, bytes: number) =>
    da.withWorkspace(c, (tx) => confirmMedia(tx, id, bytes));
  const usage = () => da.withWorkspace(asEd, (tx) => getStorageUsage(tx, workspaceId));
  const pgMessage = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (error) {
      return findPgError(error)?.message ?? 'unknown';
    }
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
    workspaceId = acme.workspaceId;
    await t.owner.insert(workspaceMembers).values([
      { workspaceId, userId: ed.id, role: 'editor' },
      { workspaceId, userId: vic.id, role: 'viewer' },
    ]);
    asEd = await ctx(ed.id, 'acme');
    asVic = await ctx(vic.id, 'acme');
    asEve = await ctx(eve.id, 'evil');
    channelId = await da.withWorkspace(acme, async (tx) => {
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
      return channel.id;
    });
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('reserves, then confirms, charging the quota once', async () => {
    const i = input({ bytes: 4321 });
    const before = await usage();
    expect(await reserve(asEd, i)).toEqual({ ok: true });

    const reserved = await da.withWorkspace(asVic, (tx) => getMedia(tx, workspaceId, i.mediaId));
    expect(reserved?.status).toBe('uploading');
    expect(await usage()).toBe(before);

    expect(await confirm(asEd, i.mediaId, 4321)).toEqual({ ok: true });
    const confirmed = await da.withWorkspace(asVic, (tx) => getMedia(tx, workspaceId, i.mediaId));
    expect(confirmed?.status).toBe('processing');
    expect(await usage()).toBe(before + 4321);

    expect(await confirm(asEd, i.mediaId, 4321)).toEqual({ ok: false, error: 'not_uploading' });
    expect(await usage()).toBe(before + 4321);
  });

  it('lets viewers see the library but not upload', async () => {
    expect(await reserve(asVic, input())).toEqual({ ok: false, error: 'forbidden' });
    const i = input();
    await reserve(asEd, i);
    expect(await confirm(asVic, i.mediaId, i.bytes)).toEqual({ ok: false, error: 'forbidden' });
    const library = await da.withWorkspace(asVic, (tx) => listMedia(tx, workspaceId));
    expect(library.map((m) => m.id)).toContain(i.mediaId);
  });

  it('keeps other workspaces out', async () => {
    expect(await reserve(asEve, input())).toEqual({ ok: false, error: 'forbidden' });
    const i = input();
    await reserve(asEd, i);
    expect(await confirm(asEve, i.mediaId, i.bytes)).toEqual({ ok: false, error: 'not_found' });
    const seen = await da.withWorkspace(asEve, (tx) => getMedia(tx, workspaceId, i.mediaId));
    expect(seen).toBeNull();
  });

  it('refuses keys outside the media folder', async () => {
    const mediaId = randomUUID();
    for (const storageKey of [
      `ws/${asEve.workspaceId}/${mediaId}/original.png`,
      `ws/${workspaceId}/${randomUUID()}/original.png`,
      `ws/${workspaceId}/${mediaId}/../../x/original.png/evil`,
    ]) {
      expect(await reserve(asEd, input({ mediaId, storageKey }))).toEqual({
        ok: false,
        error: 'invalid_key',
      });
    }
  });

  it('refuses a confirm whose stored size differs from the reservation', async () => {
    const i = input({ bytes: 500 });
    await reserve(asEd, i);
    expect(await confirm(asEd, i.mediaId, 501)).toEqual({ ok: false, error: 'size_mismatch' });
  });

  it('counts uploads in flight against the quota', async () => {
    await t.owner
      .update(workspaces)
      .set({ storageBytesUsed: 0 })
      .where(eq(workspaces.id, workspaceId));
    await t.owner.delete(mediaAssets).where(eq(mediaAssets.workspaceId, workspaceId));
    const half = Math.floor(WORKSPACE_STORAGE_QUOTA_BYTES / 2);
    expect(await reserve(asEd, input({ bytes: half }))).toEqual({ ok: true });
    expect(await reserve(asEd, input({ bytes: half }))).toEqual({ ok: true });
    expect(await reserve(asEd, input({ bytes: half }))).toEqual({
      ok: false,
      error: 'quota_exceeded',
    });
    await t.owner.delete(mediaAssets).where(eq(mediaAssets.workspaceId, workspaceId));
  });

  it('keeps worker-only fields away from users', async () => {
    const i = input();
    await reserve(asEd, i);
    for (const set of [
      { status: 'ready' as const },
      { width: 100 },
      { bytes: 1 },
      { storageKey: 'ws/x/y/original.png' },
    ]) {
      expect(
        await pgMessage(
          da.withWorkspace(asEd, (tx) =>
            tx.update(mediaAssets).set(set).where(eq(mediaAssets.id, i.mediaId)),
          ),
        ),
      ).toBe('worker_only_field');
    }
    // Direct inserts must go through app.reserve_media.
    expect(
      await pgMessage(
        da.withWorkspace(asEd, (tx) =>
          tx.insert(mediaAssets).values({
            workspaceId,
            filename: 'x.png',
            mime: 'image/png',
            bytes: 1,
            storageKey: `ws/${workspaceId}/${randomUUID()}/original.png`,
          }),
        ),
      ),
    ).not.toBeNull();
    // Renaming and re-filing are fine.
    await da.withWorkspace(asEd, (tx) =>
      tx
        .update(mediaAssets)
        .set({ filename: 'renamed.png', retention: 'library' })
        .where(eq(mediaAssets.id, i.mediaId)),
    );
    const row = await da.withWorkspace(asEd, (tx) => getMedia(tx, workspaceId, i.mediaId));
    expect(row?.filename).toBe('renamed.png');
    expect(row?.retention).toBe('library');
  });

  it('soft-deletes for good', async () => {
    const i = input();
    await reserve(asEd, i);
    expect(await da.withWorkspace(asVic, (tx) => deleteMedia(tx, workspaceId, i.mediaId))).toBe(
      false,
    );
    expect(await da.withWorkspace(asEd, (tx) => deleteMedia(tx, workspaceId, i.mediaId))).toBe(
      true,
    );
    expect(await da.withWorkspace(asEd, (tx) => getMedia(tx, workspaceId, i.mediaId))).toBeNull();
    expect(
      await pgMessage(
        da.withWorkspace(asEd, (tx) =>
          tx.update(mediaAssets).set({ deletedAt: null }).where(eq(mediaAssets.id, i.mediaId)),
        ),
      ),
    ).toBe('media_deleted');
  });

  it('locks attachments once their post is in flight', async () => {
    const i = input();
    await reserve(asEd, i);
    const [group] = await t.owner.insert(postGroups).values({ workspaceId }).returning();
    if (!group) throw new Error('no group');
    const [post] = await t.owner
      .insert(posts)
      .values({ workspaceId, groupId: group.id, channelId, status: 'draft' })
      .returning();
    if (!post) throw new Error('no post');
    const [item] = await t.owner
      .insert(postItems)
      .values({ workspaceId, postId: post.id, position: 0, body: 'hi' })
      .returning();
    if (!item) throw new Error('no item');

    await da.withWorkspace(asEd, (tx) =>
      tx
        .insert(postItemMedia)
        .values({ workspaceId, postItemId: item.id, position: 0, mediaId: i.mediaId }),
    );
    expect(
      await pgMessage(
        da.withWorkspace(asVic, (tx) =>
          tx
            .update(postItemMedia)
            .set({ altText: 'a cat' })
            .where(eq(postItemMedia.postItemId, item.id)),
        ),
      ),
    ).toBeNull(); // RLS hides the row from viewers' updates: nothing changes, no error.
    await da.withWorkspace(asEd, (tx) =>
      tx
        .update(postItemMedia)
        .set({ altText: 'a cat' })
        .where(eq(postItemMedia.postItemId, item.id)),
    );

    await t.owner
      .update(posts)
      .set({ status: 'scheduled', scheduledAt: new Date() })
      .where(eq(posts.id, post.id));
    await t.owner.update(posts).set({ status: 'queued' }).where(eq(posts.id, post.id));
    expect(
      await pgMessage(
        da.withWorkspace(asEd, (tx) =>
          tx
            .update(postItemMedia)
            .set({ altText: 'changed' })
            .where(eq(postItemMedia.postItemId, item.id)),
        ),
      ),
    ).toBe('post_locked');

    // Media in use cannot be hard-deleted, even by the worker.
    expect(
      await pgMessage(t.owner.delete(mediaAssets).where(eq(mediaAssets.id, i.mediaId))),
    ).not.toBeNull();
    const [att] = await t.owner
      .select()
      .from(postItemMedia)
      .where(eq(postItemMedia.postItemId, item.id));
    expect(att?.altText).toBe('a cat');
  });

  it('does not attach media from another workspace', async () => {
    const theirs = input({ workspaceId: asEve.workspaceId });
    expect(await reserve(asEve, theirs)).toEqual({ ok: true });
    const [group] = await t.owner.insert(postGroups).values({ workspaceId }).returning();
    if (!group) throw new Error('no group');
    const [post] = await t.owner
      .insert(posts)
      .values({ workspaceId, groupId: group.id, channelId })
      .returning();
    if (!post) throw new Error('no post');
    const [item] = await t.owner
      .insert(postItems)
      .values({ workspaceId, postId: post.id, position: 0 })
      .returning();
    if (!item) throw new Error('no item');
    expect(
      await pgMessage(
        da.withWorkspace(asEd, (tx) =>
          tx
            .insert(postItemMedia)
            .values({ workspaceId, postItemId: item.id, position: 0, mediaId: theirs.mediaId }),
        ),
      ),
    ).not.toBeNull();
  });
});
