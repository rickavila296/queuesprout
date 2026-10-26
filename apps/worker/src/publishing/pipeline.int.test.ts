import { randomBytes, randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createKeyring,
  decryptCredentials,
  encryptCredentials,
} from '@queuesprout/core/credentials';
import { MAX_RETRIES } from '@queuesprout/core/publishing';
import { createDataAccess, retryPost, schema } from '@queuesprout/db';
import { beginStep, claimPosts } from '@queuesprout/db/publishing';
import { accountCredentials } from '@queuesprout/db/schema/credentials';
import { createTestDatabase, type TestDatabase } from '@queuesprout/db/testing';
import type { AdapterResolution, ProviderAdapter } from '@queuesprout/providers';
import type { ProviderId, PublishStep } from '@queuesprout/shared';
import { createAdapterPicker } from '../adapters';
import { dispatchOnce } from './dispatcher';
import { refreshExpiringTokens } from './refresh';
import { runStep, type PipelineDeps } from './step';

const {
  connectedAccounts,
  channels,
  mediaAssets,
  postItemMedia,
  postGroups,
  postItems,
  posts,
  publishAttempts,
  user,
  workspaceMembers,
  workspaces,
} = schema;

const keyring = createKeyring(new Map([[1, randomBytes(32)]]), 1);
const silent = { info: () => undefined, warn: () => undefined };

describe('publishing pipeline (mock mode, real Postgres)', () => {
  let t: TestDatabase;
  let clock: Date;
  let queue: Array<{ postId: string; runAt: Date }>;
  /** Every adapter.publish() call, to prove nothing is posted twice. */
  let calls: Array<{ postId: string; position: number; mediaIds?: string[] }>;
  /** Steps to return instead of the mock's result, keyed by item body. */
  let overrides: Map<string, PublishStep[]>;
  let workspaceId: string;
  let ownerId: string;

  const mockPicker = createAdapterPicker(
    { PUBLISH_MODE: 'mock', PUBLIC_URL: 'http://localhost:3000' },
    { wait: async () => undefined, random: () => 0.9 },
  );

  /** Providers whose adapter acts as if its image support has not shipped. */
  const withoutMedia = new Set<ProviderId>();

  /** The mock adapter, with call tracking and scripted failures. */
  const pickAdapter = (sel: { provider: ProviderId; workspaceIsSandbox: boolean }) => {
    const resolved = mockPicker(sel);
    if (!resolved.ok) return resolved;
    const inner = resolved.adapter;
    const adapter: ProviderAdapter = {
      ...inner,
      capabilities: {
        ...inner.capabilities,
        ...(withoutMedia.has(sel.provider) && { media: false }),
      },
      async publish(ctx) {
        calls.push({
          postId: ctx.post.id,
          position: ctx.item.position,
          ...(ctx.item.mediaIds.length > 0 && { mediaIds: ctx.item.mediaIds }),
        });
        const scripted = overrides.get(ctx.item.body)?.shift();
        return scripted ?? inner.publish(ctx);
      },
    };
    return { ...resolved, adapter } satisfies AdapterResolution;
  };

  const deps = (): PipelineDeps => ({
    db: t.owner,
    keyring,
    pickAdapter,
    now: () => clock,
    log: silent,
  });

  const enqueue = async (postId: string, runAt?: Date) => {
    queue.push({ postId, runAt: runAt ?? clock });
  };

  /** Runs every enqueued step that is due, like pg-boss would, until nothing is due. */
  async function drain(): Promise<void> {
    for (let guard = 0; guard < 100; guard++) {
      const due = queue.findIndex((j) => j.runAt.getTime() <= clock.getTime());
      if (due === -1) return;
      const [job] = queue.splice(due, 1);
      if (!job) return;
      const follow = await runStep(deps(), job.postId);
      if (follow.next === 'now') await enqueue(job.postId);
      if (follow.next === 'at') await enqueue(job.postId, follow.at);
    }
    throw new Error('drain did not settle');
  }

  const tick = async () => {
    await dispatchOnce(t.owner, enqueue, clock);
    await drain();
  };
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };

  async function connect(provider: ProviderId, expiresAt: Date | null = null) {
    const externalAccountId = `ext-${randomUUID()}`;
    const [account] = await t.owner
      .insert(connectedAccounts)
      .values({
        workspaceId,
        provider,
        externalAccountId,
        displayName: 'Demo',
        connectedBy: ownerId,
      })
      .returning();
    if (!account) throw new Error('no account');
    const enc = encryptCredentials(
      keyring,
      { workspaceId, provider, externalAccountId },
      {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt,
        scopes: [],
      },
    );
    await t.owner.insert(accountCredentials).values({ accountId: account.id, ...enc });
    const [channel] = await t.owner
      .insert(channels)
      .values({
        workspaceId,
        accountId: account.id,
        provider,
        targetType: 'profile',
        externalTargetId: externalAccountId,
        name: 'Demo',
      })
      .returning();
    if (!channel) throw new Error('no channel');
    return { account, channel };
  }

  async function schedule(channelId: string, bodies: string[], at = clock) {
    const [group] = await t.owner.insert(postGroups).values({ workspaceId }).returning();
    if (!group) throw new Error('no group');
    const [post] = await t.owner
      .insert(posts)
      .values({ workspaceId, groupId: group.id, channelId, status: 'scheduled', scheduledAt: at })
      .returning();
    if (!post) throw new Error('no post');
    await t.owner.insert(postItems).values(
      bodies.map((body, position) => ({
        workspaceId,
        postId: post.id,
        position,
        kind: position === 0 ? ('post' as const) : ('reply' as const),
        body,
      })),
    );
    return post.id;
  }

  const getPost = async (id: string) => {
    const [row] = await t.owner.select().from(posts).where(eq(posts.id, id));
    if (!row) throw new Error('post missing');
    return row;
  };
  const getItems = (id: string) =>
    t.owner
      .select()
      .from(postItems)
      .where(eq(postItems.postId, id))
      .orderBy(asc(postItems.position));
  const getAttempts = (id: string) =>
    t.owner
      .select()
      .from(publishAttempts)
      .where(eq(publishAttempts.postId, id))
      .orderBy(asc(publishAttempts.attemptNo));

  beforeAll(async () => {
    t = await createTestDatabase();
    ownerId = randomUUID();
    await t.owner.insert(user).values({ id: ownerId, email: 'o@example.com', name: 'Owner' });
    const [ws] = await t.owner
      .insert(workspaces)
      .values({ name: 'Demo', slug: 'demo', isSandbox: true, createdBy: ownerId })
      .returning();
    if (!ws) throw new Error('no workspace');
    workspaceId = ws.id;
  });

  afterAll(async () => {
    await t?.drop();
  });

  beforeEach(() => {
    // Real time: the stale-job sweep compares against updated_at, which Postgres sets.
    clock = new Date(Math.floor(Date.now() / 1000) * 1000);
    queue = [];
    calls = [];
    overrides = new Map();
  });

  it('publishes a due thread item by item, replies pointing at their parent', async () => {
    const { channel } = await connect('bluesky');
    const id = await schedule(channel.id, ['one', 'two', 'three']);
    await tick();

    const post = await getPost(id);
    expect(post.status).toBe('published');
    const items = await getItems(id);
    expect(items.map((i) => i.status)).toEqual(['published', 'published', 'published']);
    expect(post.externalId).toBe(items[0]?.externalId);
    expect(post.externalUrl).toMatch(/^http:\/\/localhost:3000\/mock\/posts\/mock_bluesky_/);
    expect(items[1]?.externalMeta).toMatchObject({ replyTo: items[0]?.externalId });
    expect(items[2]?.externalMeta).toMatchObject({
      replyTo: items[1]?.externalId,
      root: items[0]?.externalId,
    });
    const attempts = await getAttempts(id);
    expect(attempts.map((a) => [a.attemptNo, a.outcome])).toEqual([
      [1, 'success'],
      [2, 'success'],
      [3, 'success'],
    ]);
    expect(calls).toHaveLength(3);
  });

  /** Attaches ready images to a post's item, as the composer would. */
  async function attach(postId: string, position: number, count: number) {
    const [item] = (await getItems(postId)).filter((i) => i.position === position);
    if (!item) throw new Error('no item');
    const ids: string[] = [];
    for (let n = 0; n < count; n++) {
      const id = randomUUID();
      await t.owner.insert(mediaAssets).values({
        id,
        workspaceId,
        filename: `${n}.png`,
        mime: 'image/png',
        bytes: 100,
        storageKey: `ws/${workspaceId}/${id}/original.png`,
        status: 'ready',
      });
      await t.owner
        .insert(postItemMedia)
        .values({ workspaceId, postItemId: item.id, position: n, mediaId: id });
      ids.push(id);
    }
    return ids;
  }

  it('hands attached images to the adapter in order', async () => {
    // LinkedIn has no real adapter yet, so its sandbox definition accepts images.
    const { channel } = await connect('linkedin');
    const id = await schedule(channel.id, ['with pictures']);
    const mediaIds = await attach(id, 0, 2);
    await tick();
    expect((await getPost(id)).status).toBe('published');
    expect(calls).toEqual([{ postId: id, position: 0, mediaIds }]);
  });

  it('fails images on a channel whose adapter cannot publish them, without calling it', async () => {
    const { channel } = await connect('discord');
    const id = await schedule(channel.id, ['picture']);
    await attach(id, 0, 1);
    withoutMedia.add('discord');
    try {
      await tick();
    } finally {
      withoutMedia.delete('discord');
    }
    const post = await getPost(id);
    expect([post.status, post.errorKind]).toEqual(['failed', 'validation']);
    expect(post.errorMessage).toMatch(/Images cannot be published to this channel yet/);
    expect(calls).toEqual([]);
  });

  it('leaves drafts and future posts alone', async () => {
    const { channel } = await connect('mastodon');
    const future = await schedule(channel.id, ['later'], new Date(clock.getTime() + 60_000));
    await tick();
    expect((await getPost(future)).status).toBe('scheduled');
    expect(calls).toEqual([]);
    advance(60_000);
    await tick();
    expect((await getPost(future)).status).toBe('published');
  });

  it('retries a simulated 503 and never re-posts the items already out', async () => {
    const { channel } = await connect('bluesky');
    const id = await schedule(channel.id, ['first', 'second', 'third']);
    overrides.set('second', [
      { kind: 'error', errorKind: 'transient', message: 'Platform error (503).' },
    ]);

    await tick();
    let post = await getPost(id);
    expect(post).toMatchObject({ status: 'publishing', errorKind: 'transient', attemptCount: 1 });
    const firstId = (await getItems(id))[0]?.externalId;
    expect(queue).toEqual([{ postId: id, runAt: new Date(clock.getTime() + 30_000) }]);

    advance(30_000);
    await drain();
    post = await getPost(id);
    expect(post).toMatchObject({ status: 'published', errorKind: null, attemptCount: 0 });
    const items = await getItems(id);
    expect(items[0]?.externalId).toBe(firstId);
    // Item 0 went out exactly once; item 1 twice (the 503, then success).
    expect(calls.map((c) => c.position)).toEqual([0, 1, 1, 2]);
    expect((await getAttempts(id)).map((a) => a.outcome)).toEqual([
      'success',
      'retryable_error',
      'success',
      'success',
    ]);
  });

  it(`fails the post after ${MAX_RETRIES} retries`, async () => {
    const { channel } = await connect('telegram');
    const id = await schedule(channel.id, ['always busy [[mock:transient]]']);
    await tick();
    for (let i = 0; i < MAX_RETRIES; i++) {
      advance(15 * 60_000);
      await drain();
    }
    const post = await getPost(id);
    expect(post.status).toBe('failed');
    expect(post.errorMessage).toContain(`Gave up after ${MAX_RETRIES} retries`);
    expect(calls).toHaveLength(MAX_RETRIES + 1);
    expect((await getItems(id))[0]?.status).toBe('failed');
  });

  it('retries a failed thread from the post page without re-posting what is out', async () => {
    const { channel } = await connect('mastodon');
    const id = await schedule(channel.id, ['first', 'second', 'third']);
    overrides.set('second', [
      { kind: 'error', errorKind: 'validation', message: 'Platform refused it.' },
    ]);
    await tick();
    expect(await getPost(id)).toMatchObject({ status: 'failed', errorKind: 'validation' });
    expect((await getItems(id)).map((i) => i.status)).toEqual(['published', 'failed', 'pending']);
    const firstId = (await getItems(id))[0]?.externalId;

    // An editor presses Retry: the web role, through app.retry_post().
    await t.owner
      .insert(workspaceMembers)
      .values({ workspaceId, userId: ownerId, role: 'owner' })
      .onConflictDoNothing();
    const da = createDataAccess(t.web);
    const asOwner = await da.resolveWorkspace(ownerId, 'demo');
    if (!asOwner) throw new Error('not a member');
    expect(await da.withWorkspace(asOwner, (tx) => retryPost(tx, id, false))).toEqual({
      ok: true,
    });

    // retry_post schedules for the database's now(), a moment after this test's clock.
    advance(60_000);
    await tick();
    expect(await getPost(id)).toMatchObject({ status: 'published', errorKind: null });
    const items = await getItems(id);
    expect(items.map((i) => i.status)).toEqual(['published', 'published', 'published']);
    expect(items[0]?.externalId).toBe(firstId);
    // Item 0 went out once; item 1 failed, then went out on the retry.
    expect(calls.map((c) => c.position)).toEqual([0, 1, 1, 2]);
  });

  it('marks the account needs_reauth on an auth error and blocks its other posts', async () => {
    const { account, channel } = await connect('discord');
    const a = await schedule(channel.id, ['token revoked [[mock:auth]]']);
    await tick();
    expect(await getPost(a)).toMatchObject({ status: 'failed', errorKind: 'auth' });
    const [acct] = await t.owner
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, account.id));
    expect(acct?.status).toBe('needs_reauth');

    calls = [];
    const b = await schedule(channel.id, ['fine']);
    await tick();
    expect(await getPost(b)).toMatchObject({ status: 'failed', errorKind: 'auth' });
    expect(calls).toEqual([]);
  });

  it('never retries an outcome it cannot know', async () => {
    const { channel } = await connect('slack');
    const id = await schedule(channel.id, ['sent but no answer [[mock:timeout]]']);
    await tick();
    const post = await getPost(id);
    expect(post).toMatchObject({ status: 'failed', errorKind: 'unknown' });
    expect(post.errorMessage).toContain('Check the platform');
    expect(queue).toEqual([]);
    expect((await getAttempts(id))[0]?.outcome).toBe('unknown');
  });

  it('checks back on async containers without recreating them', async () => {
    const { channel } = await connect('instagram');
    const id = await schedule(channel.id, ['carousel soon']);
    await tick();

    let post = await getPost(id);
    expect(post.status).toBe('processing');
    const container = post.externalContainerId;
    expect(container).toMatch(/^mock_container_/);
    expect(post.publishCheckpoint).toMatchObject({ stage: 'container_created', position: 0 });
    expect(post.nextCheckAt).toEqual(new Date(clock.getTime() + 1000));

    // Not due yet: nothing happens.
    await tick();
    expect(calls).toHaveLength(1);

    // random = 0.9 means two status checks: pending once more, then done.
    advance(1000);
    await tick();
    expect((await getPost(id)).status).toBe('processing');
    advance(1000);
    await tick();
    post = await getPost(id);
    expect(post).toMatchObject({
      status: 'published',
      publishCheckpoint: null,
      externalContainerId: null,
    });
    expect((await getItems(id))[0]?.externalMeta).toMatchObject({ containerId: container });
    expect((await getAttempts(id)).map((a) => a.outcome)).toEqual([
      'pending',
      'pending',
      'success',
    ]);
  });

  it('fails a post whose platform processing passes its deadline', async () => {
    const { channel } = await connect('threads');
    const id = await schedule(channel.id, ['slow video']);
    await tick();
    expect((await getPost(id)).status).toBe('processing');
    advance(31 * 60_000);
    await tick();
    expect(await getPost(id)).toMatchObject({
      status: 'failed',
      errorKind: 'expired',
      errorMessage: 'Platform processing timed out.',
    });
  });

  it('treats a step that died mid-call as unknown instead of posting again', async () => {
    const { channel } = await connect('bluesky');
    const id = await schedule(channel.id, ['crash after send']);
    await dispatchOnce(t.owner, async () => undefined, clock);
    // A worker opened the attempt, then died before recording the result.
    expect((await beginStep(t.owner, id, clock)).kind).toBe('work');
    // The job is retried by pg-boss (or re-enqueued as stale).
    await runStep(deps(), id);
    expect(await getPost(id)).toMatchObject({ status: 'failed', errorKind: 'unknown' });
    expect(calls).toEqual([]);
    expect((await getAttempts(id))[0]?.outcome).toBe('unknown');
  });

  it('claims each due post once across concurrent dispatchers', async () => {
    const { channel } = await connect('mastodon');
    const ids = await Promise.all(
      Array.from({ length: 10 }, (_, i) => schedule(channel.id, [`post ${i}`])),
    );
    const [a, b] = await Promise.all([claimPosts(t.owner, clock), claimPosts(t.owner, clock)]);
    const claimed = [...(a ?? []), ...(b ?? [])]
      .map((c) => c.postId)
      .filter((p) => ids.includes(p));
    expect(claimed.sort()).toEqual([...ids].sort());
    // Claimed but never run: cancel them so later tests' stale sweeps leave them alone.
    for (const id of ids) {
      await t.owner.update(posts).set({ status: 'cancelled' }).where(eq(posts.id, id));
    }
  });

  it('re-enqueues posts whose job was lost', async () => {
    const { channel } = await connect('telegram');
    const id = await schedule(channel.id, ['lost job']);
    await dispatchOnce(t.owner, async () => undefined, clock); // job never runs
    expect((await getPost(id)).status).toBe('queued');
    advance(11 * 60_000);
    await tick();
    expect((await getPost(id)).status).toBe('published');
  });

  it('skips a post cancelled before its step ran', async () => {
    const { channel } = await connect('bluesky');
    const id = await schedule(channel.id, ['never mind']);
    await dispatchOnce(t.owner, enqueue, clock);
    await t.owner.update(posts).set({ status: 'cancelled' }).where(eq(posts.id, id));
    await drain();
    expect((await getPost(id)).status).toBe('cancelled');
    expect(calls).toEqual([]);
  });

  it('refreshes an expired token inside the step, under the row lock', async () => {
    const { account, channel } = await connect('linkedin', new Date(clock.getTime() - 1000));
    const id = await schedule(channel.id, ['needs a fresh token']);
    await tick();
    expect((await getPost(id)).status).toBe('published');
    const [row] = await t.owner
      .select()
      .from(accountCredentials)
      .where(eq(accountCredentials.accountId, account.id));
    if (!row) throw new Error('credentials missing');
    const creds = decryptCredentials(
      keyring,
      { workspaceId, provider: 'linkedin', externalAccountId: account.externalAccountId },
      row,
    );
    expect(creds.accessToken).toMatch(/^mock-access-/);
  });

  it('refreshes tokens that expire soon in the token.refresh job', async () => {
    const soon = await connect('youtube', new Date(clock.getTime() + 10 * 60_000));
    const later = await connect('youtube', new Date(clock.getTime() + 24 * 3_600_000));
    const summary = await refreshExpiringTokens(deps());
    expect(summary.refreshed).toBeGreaterThanOrEqual(1);
    const read = async (accountId: string, externalAccountId: string) => {
      const [row] = await t.owner
        .select()
        .from(accountCredentials)
        .where(eq(accountCredentials.accountId, accountId));
      if (!row) throw new Error('credentials missing');
      return decryptCredentials(
        keyring,
        { workspaceId, provider: 'youtube', externalAccountId },
        row,
      ).accessToken;
    };
    expect(await read(soon.account.id, soon.account.externalAccountId)).toMatch(/^mock-access-/);
    expect(await read(later.account.id, later.account.externalAccountId)).toBe('access-1');
  });
});
