import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@queuesprout/db';
import { createTestDatabase, type TestDatabase } from '@queuesprout/db/testing';
import type { MediaStatus, PostStatus } from '@queuesprout/shared';
import {
  createStorage,
  headObject,
  originalKey,
  putObject,
  variantKey,
  type Storage,
} from '@queuesprout/storage';
import { runMediaRetention } from './retention';

const {
  channels,
  connectedAccounts,
  mediaAssets,
  postGroups,
  postItemMedia,
  postItems,
  posts,
  workspaces,
} = schema;

/** Needs Postgres and an S3-compatible server (SeaweedFS in CI), like the probe tests. */
const endpoint = process.env.TEST_S3_ENDPOINT;

const DAY = 86_400_000;
const NOW = new Date('2026-10-26T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe.skipIf(!endpoint)('media.retention (real Postgres and S3)', () => {
  let t: TestDatabase;
  let storage: Storage;
  let workspaceId: string;
  let channelId: string;
  const log = { warn: () => undefined };
  const run = (s: Storage = storage) =>
    runMediaRetention({ db: t.owner, storage: s, now: () => NOW, log });

  /** A file with its original and thumbnail in the bucket, charged to the quota if confirmed. */
  async function media(input: {
    status?: MediaStatus;
    retention?: 'auto' | 'library';
    createdAt?: Date;
    updatedAt?: Date;
    deletedAt?: Date;
  }) {
    const id = randomUUID();
    const storageKey = originalKey(workspaceId, id, 'png');
    const thumbnailKey = variantKey(workspaceId, id, 'thumb', 'webp');
    const status = input.status ?? 'ready';
    await putObject(storage, storageKey, new Uint8Array([1, 2, 3]), 'image/png');
    await putObject(storage, thumbnailKey, new Uint8Array([4]), 'image/webp');
    await t.owner.insert(mediaAssets).values({
      id,
      workspaceId,
      filename: 'a.png',
      mime: 'image/png',
      bytes: 1000,
      storageKey,
      thumbnailKey,
      status,
      retention: input.retention ?? 'auto',
      createdAt: input.createdAt ?? ago(60 * DAY),
      // The updated_at trigger runs on UPDATE only, so the time the test means sticks.
      updatedAt: input.updatedAt ?? input.createdAt ?? ago(60 * DAY),
      deletedAt: input.deletedAt ?? null,
    });
    if (status !== 'uploading') {
      await t.owner
        .update(workspaces)
        .set({ storageBytesUsed: sql`${workspaces.storageBytesUsed} + 1000` })
        .where(eq(workspaces.id, workspaceId));
    }
    return { id, storageKey, thumbnailKey };
  }

  /** A post in the given status, last changed at updatedAt, using the file. */
  async function usedBy(mediaId: string, status: PostStatus, updatedAt: Date) {
    const [group] = await t.owner.insert(postGroups).values({ workspaceId }).returning();
    if (!group) throw new Error('no group');
    const [post] = await t.owner
      .insert(posts)
      .values({
        workspaceId,
        groupId: group.id,
        channelId,
        status,
        scheduledAt: updatedAt,
        updatedAt,
      })
      .returning();
    if (!post) throw new Error('no post');
    const [item] = await t.owner
      .insert(postItems)
      .values({ workspaceId, postId: post.id, position: 0, body: 'hi' })
      .returning();
    if (!item) throw new Error('no item');
    await t.owner
      .insert(postItemMedia)
      .values({ workspaceId, postItemId: item.id, position: 0, mediaId });
  }

  const row = async (id: string) => {
    const [r] = await t.owner.select().from(mediaAssets).where(eq(mediaAssets.id, id));
    if (!r) throw new Error('missing');
    return r;
  };
  const used = async () => {
    const [w] = await t.owner.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    return w?.storageBytesUsed;
  };
  const exists = async (key: string) => (await headObject(storage, key)) !== null;

  beforeAll(async () => {
    t = await createTestDatabase();
    storage = createStorage({
      endpoint: endpoint ?? 'http://localhost:8333',
      bucket: process.env.TEST_S3_BUCKET ?? 'queuesprout-media',
      accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? 'queuesprout',
      secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'queuesprout-s3-secret',
      forcePathStyle: true,
    });
    const [ws] = await t.owner
      .insert(workspaces)
      .values({ name: 'Acme', slug: `acme-${randomUUID().slice(0, 8)}` })
      .returning();
    if (!ws) throw new Error('no workspace');
    workspaceId = ws.id;
    const [account] = await t.owner
      .insert(connectedAccounts)
      .values({
        workspaceId,
        provider: 'bluesky',
        externalAccountId: 'acme.bsky',
        displayName: 'Acme',
      })
      .returning();
    if (!account) throw new Error('no account');
    const [channel] = await t.owner
      .insert(channels)
      .values({
        workspaceId,
        accountId: account.id,
        provider: 'bluesky',
        targetType: 'profile',
        externalTargetId: 'acme.bsky',
        name: 'Acme',
      })
      .returning();
    if (!channel) throw new Error('no channel');
    channelId = channel.id;
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('removes what nothing needs, gives the quota back and keeps the row', async () => {
    const deleted = await media({ deletedAt: ago(DAY), retention: 'library' });
    const oldAuto = await media({});
    const autoAfterPost = await media({});
    await usedBy(autoAfterPost.id, 'published', ago(31 * DAY));
    const abandoned = await media({ status: 'uploading', createdAt: ago(25 * 60 * 60 * 1000) });
    const failed = await media({ status: 'failed', updatedAt: ago(8 * DAY) });
    const before = await used();

    expect(await run()).toEqual({ purged: 5, removed: 5, errors: 0 });

    for (const m of [deleted, oldAuto, autoAfterPost, abandoned, failed]) {
      const r = await row(m.id);
      expect([r.status, r.purgedAt?.toISOString(), r.thumbnailKey]).toEqual([
        'purged',
        NOW.toISOString(),
        null,
      ]);
      expect(await exists(m.storageKey)).toBe(false);
      expect(await exists(m.thumbnailKey)).toBe(false);
    }
    // Four were charged at confirm; the abandoned upload never was.
    expect(await used()).toBe((before ?? 0) - 4000);
  });

  it('keeps files a post may still publish, library files and recent ones', async () => {
    const kept = [
      await media({ retention: 'library' }),
      await media({ createdAt: ago(10 * DAY) }),
      await media({ status: 'uploading', createdAt: ago(60 * 60 * 1000) }),
      await media({ status: 'failed', createdAt: ago(3 * DAY), updatedAt: ago(2 * DAY) }),
    ];
    const recentPost = await media({});
    await usedBy(recentPost.id, 'published', ago(5 * DAY));
    kept.push(recentPost);
    // Deleted from the library, but posts that may still go out hold them.
    for (const status of ['draft', 'scheduled', 'pending_approval', 'queued'] as const) {
      const m = await media({ deletedAt: ago(DAY) });
      await usedBy(m.id, status, ago(90 * DAY));
      kept.push(m);
    }
    const retryable = await media({ deletedAt: ago(DAY) });
    await usedBy(retryable.id, 'failed', ago(3 * DAY));
    kept.push(retryable);

    expect(await run()).toEqual({ purged: 0, removed: 0, errors: 0 });
    for (const m of kept) {
      expect((await row(m.id)).status).not.toBe('purged');
      expect(await exists(m.storageKey)).toBe(true);
    }
  });

  it('releases a failed post’s files after the retry window, and one held file waits for all', async () => {
    const stale = await media({ deletedAt: ago(DAY) });
    await usedBy(stale.id, 'failed', ago(31 * DAY));
    const shared = await media({ deletedAt: ago(DAY) });
    await usedBy(shared.id, 'published', ago(40 * DAY));
    await usedBy(shared.id, 'scheduled', ago(DAY));

    await run();
    expect((await row(stale.id)).status).toBe('purged');
    expect((await row(shared.id)).status).toBe('ready');
  });

  it('retries object removal on the next run when storage is down', async () => {
    const m = await media({ deletedAt: ago(DAY) });
    const down = createStorage({
      endpoint: 'http://127.0.0.1:1',
      bucket: 'queuesprout-media',
      accessKeyId: 'x',
      secretAccessKey: 'y',
      forcePathStyle: true,
    });
    const first = await run(down);
    expect(first).toMatchObject({ purged: 1, removed: 0 });
    expect(first.errors).toBeGreaterThanOrEqual(1);
    expect((await row(m.id)).status).toBe('purged');
    expect((await row(m.id)).purgedAt).toBeNull();
    expect(await exists(m.storageKey)).toBe(true);

    expect(await run()).toEqual({ purged: 0, removed: 1, errors: 0 });
    expect(await exists(m.storageKey)).toBe(false);
    expect((await row(m.id)).purgedAt?.toISOString()).toBe(NOW.toISOString());
  });
});
