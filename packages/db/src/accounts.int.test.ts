import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findPgError } from './errors';
import { createDataAccess, type DataAccess, type WorkspaceContext } from './context';
import { connectAccount, listChannels, upsertChannel } from './queries/accounts';
import { withLockedCredentials } from './queries/credentials';
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
import { accountCredentials } from './schema/credentials';
import { createTestDatabase, type TestDatabase } from './test-utils';

const blob = (s: string) => Buffer.from(s);

/** Drizzle wraps driver errors; assert on the Postgres message underneath. */
async function expectPgError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, 'expected the query to fail').not.toBeNull();
  expect(findPgError(error)?.message).toMatch(pattern);
}

describe('accounts, credentials and posts', () => {
  let t: TestDatabase;
  let da: DataAccess;
  const alice = { id: randomUUID(), email: 'alice@example.com', name: 'Alice' }; // owner of acme
  const ed = { id: randomUUID(), email: 'ed@example.com', name: 'Ed' }; // editor in acme
  const vic = { id: randomUUID(), email: 'vic@example.com', name: 'Vic' }; // viewer in acme
  const eve = { id: randomUUID(), email: 'eve@example.com', name: 'Eve' }; // owner of evil
  let acme: WorkspaceContext;
  let asEd: WorkspaceContext;
  let asVic: WorkspaceContext;
  let evil: WorkspaceContext;
  let acmeAccount: string;
  let acmeChannel: string;
  let evilChannel: string;

  const ctx = async (userId: string, slug: string) => {
    const c = await da.resolveWorkspace(userId, slug);
    if (!c) throw new Error(`${userId} is not a member of ${slug}`);
    return c;
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
    acme = await ctx(alice.id, 'acme');
    evil = await ctx(eve.id, 'evil');
    await t.owner.insert(workspaceMembers).values([
      { workspaceId: acme.workspaceId, userId: ed.id, role: 'editor' },
      { workspaceId: acme.workspaceId, userId: vic.id, role: 'viewer' },
    ]);
    asEd = await ctx(ed.id, 'acme');
    asVic = await ctx(vic.id, 'acme');
  });

  afterAll(async () => {
    await t?.drop();
  });

  const connect = (c: WorkspaceContext, externalAccountId = 'did:plc:acme') =>
    da.withWorkspace(c, (tx) =>
      connectAccount(tx, {
        workspaceId: c.workspaceId,
        provider: 'bluesky',
        externalAccountId,
        displayName: 'acme.bsky.social',
        accessTokenEnc: blob('cipher-1'),
        refreshTokenEnc: blob('refresh-1'),
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: ['atproto'],
        keyVersion: 1,
      }),
    );

  it('lets admins connect an account with its secrets', async () => {
    const result = await connect(acme);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    acmeAccount = result.accountId;

    const creds = await t.owner
      .select()
      .from(accountCredentials)
      .where(eq(accountCredentials.accountId, acmeAccount));
    expect(creds[0]?.accessTokenEnc.toString()).toBe('cipher-1');
    expect(creds[0]?.scopes).toEqual(['atproto']);

    const channel = await da.withWorkspace(acme, (tx) =>
      upsertChannel(tx, {
        workspaceId: acme.workspaceId,
        accountId: acmeAccount,
        provider: 'bluesky',
        targetType: 'profile',
        externalTargetId: 'did:plc:acme',
        name: 'Acme',
        handle: 'acme.bsky.social',
      }),
    );
    acmeChannel = channel.id;
  });

  it('reconnecting replaces the secrets and reactivates the account', async () => {
    await t.owner
      .update(connectedAccounts)
      .set({ status: 'needs_reauth' })
      .where(eq(connectedAccounts.id, acmeAccount));
    const again = await connect(acme);
    expect(again).toEqual({ ok: true, accountId: acmeAccount });
    const rows = await t.owner
      .select({ status: connectedAccounts.status })
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, acmeAccount));
    expect(rows[0]?.status).toBe('active');
  });

  it('refuses to connect accounts for editors and viewers', async () => {
    expect(await connect(asEd, 'did:plc:ed')).toEqual({ ok: false, error: 'forbidden' });
    expect(await connect(asVic, 'did:plc:vic')).toEqual({ ok: false, error: 'forbidden' });
  });

  it('never lets the web role read secrets, even as owner', async () => {
    await expectPgError(
      da.withWorkspace(acme, (tx) => tx.select().from(accountCredentials)),
      /permission denied/,
    );
    await expectPgError(
      da.withWorkspace(acme, (tx) => tx.execute(sql`select * from provider_apps`)),
      /permission denied/,
    );
  });

  it('shows channels to members only', async () => {
    const forVic = await da.withWorkspace(asVic, (tx) => listChannels(tx, acme.workspaceId));
    expect(forVic.map((c) => [c.name, c.accountStatus])).toEqual([['Acme', 'active']]);
    const forEve = await da.withWorkspace(evil, (tx) => listChannels(tx, acme.workspaceId));
    expect(forEve).toEqual([]);
  });

  it('refuses channels from viewers and editors', async () => {
    await expectPgError(
      da.withWorkspace(asEd, (tx) =>
        upsertChannel(tx, {
          workspaceId: acme.workspaceId,
          accountId: acmeAccount,
          provider: 'bluesky',
          targetType: 'profile',
          externalTargetId: 'x',
          name: 'X',
        }),
      ),
      /row-level security/,
    );
  });

  /** Inserts a group and a post as the given member; returns the post id. */
  const createPost = (c: WorkspaceContext, channelId: string, status: 'draft' | 'scheduled') =>
    da.withWorkspace(c, async (tx) => {
      const [group] = await tx
        .insert(postGroups)
        .values({ workspaceId: c.workspaceId, createdBy: c.userId, baseBody: 'hello' })
        .returning();
      if (!group) throw new Error('no group');
      const [post] = await tx
        .insert(posts)
        .values({
          workspaceId: c.workspaceId,
          groupId: group.id,
          channelId,
          status,
          scheduledAt: status === 'scheduled' ? new Date(Date.now() + 60_000) : null,
        })
        .returning();
      if (!post) throw new Error('no post');
      await tx.insert(postItems).values([
        { workspaceId: c.workspaceId, postId: post.id, position: 0, body: 'hello' },
        { workspaceId: c.workspaceId, postId: post.id, position: 1, kind: 'reply', body: 'more' },
      ]);
      return post.id;
    });

  it('lets editors schedule posts but not viewers', async () => {
    const id = await createPost(asEd, acmeChannel, 'scheduled');
    expect(id).toBeTruthy();
    await expectPgError(createPost(asVic, acmeChannel, 'draft'), /row-level security/);
  });

  it("refuses a post on another workspace's channel", async () => {
    const evilAccount = await connect(evil, 'did:plc:evil');
    if (!evilAccount.ok) throw new Error('evil connect failed');
    const ch = await da.withWorkspace(evil, (tx) =>
      upsertChannel(tx, {
        workspaceId: evil.workspaceId,
        accountId: evilAccount.accountId,
        provider: 'bluesky',
        targetType: 'profile',
        externalTargetId: 'did:plc:evil',
        name: 'Evil',
      }),
    );
    evilChannel = ch.id;
    // Eve knows acme's channel id: the composite foreign key still stops her.
    await expectPgError(createPost(evil, acmeChannel, 'draft'), /foreign key/);
    // And acme cannot post to Eve's channel either.
    await expectPgError(createPost(acme, evilChannel, 'draft'), /foreign key/);
    // Nor hang a channel under another workspace's account.
    await expectPgError(
      da.withWorkspace(evil, (tx) =>
        upsertChannel(tx, {
          workspaceId: evil.workspaceId,
          accountId: acmeAccount,
          provider: 'bluesky',
          targetType: 'profile',
          externalTargetId: 'stolen',
          name: 'Stolen',
        }),
      ),
      /foreign key/,
    );
  });

  it('keeps worker-only statuses and fields away from the web role', async () => {
    await expectPgError(
      da.withWorkspace(asEd, (tx) =>
        tx.execute(sql`
          insert into posts (workspace_id, group_id, channel_id, status)
          select workspace_id, group_id, channel_id, 'published' from posts limit 1`),
      ),
      /worker_only_status/,
    );

    const id = await createPost(asEd, acmeChannel, 'draft');
    await expectPgError(
      da.withWorkspace(asEd, (tx) =>
        tx.update(posts).set({ status: 'published' }).where(eq(posts.id, id)),
      ),
      /worker_only_status/,
    );
    await expectPgError(
      da.withWorkspace(asEd, (tx) =>
        tx.update(posts).set({ externalId: 'fake' }).where(eq(posts.id, id)),
      ),
      /worker_only_field/,
    );
    await expectPgError(
      da.withWorkspace(asEd, (tx) =>
        tx.update(postItems).set({ status: 'published' }).where(eq(postItems.postId, id)),
      ),
      /worker_only_field/,
    );
  });

  it('bumps version on every edit', async () => {
    const id = await createPost(asEd, acmeChannel, 'draft');
    const [edited] = await da.withWorkspace(asEd, (tx) =>
      tx
        .update(posts)
        .set({ status: 'scheduled', scheduledAt: new Date(Date.now() + 120_000) })
        .where(eq(posts.id, id))
        .returning(),
    );
    expect(edited?.version).toBe(2);
  });

  it('locks a post and its items once the worker queues it', async () => {
    const id = await createPost(asEd, acmeChannel, 'scheduled');
    await t.owner.update(posts).set({ status: 'queued' }).where(eq(posts.id, id));

    await expectPgError(
      da.withWorkspace(asEd, (tx) =>
        tx.update(posts).set({ scheduledAt: new Date() }).where(eq(posts.id, id)),
      ),
      /post_locked/,
    );
    await expectPgError(
      da.withWorkspace(asEd, (tx) =>
        tx.update(postItems).set({ body: 'edited' }).where(eq(postItems.postId, id)),
      ),
      /post_locked/,
    );
    await expectPgError(
      da.withWorkspace(asEd, (tx) =>
        tx.insert(postItems).values({
          workspaceId: acme.workspaceId,
          postId: id,
          position: 5,
          body: 'sneaky',
        }),
      ),
      /post_locked/,
    );

    // The worker (owner role) is not blocked.
    await t.owner
      .update(posts)
      .set({ status: 'published', externalId: 'at://x', publishedAt: new Date() })
      .where(eq(posts.id, id));
  });

  it('lets viewers read attempts but nobody on the web role write them', async () => {
    const id = await createPost(asEd, acmeChannel, 'draft');
    await t.owner
      .insert(publishAttempts)
      .values({ workspaceId: acme.workspaceId, postId: id, attemptNo: 1, outcome: 'success' });
    const seen = await da.withWorkspace(asVic, (tx) =>
      tx.select().from(publishAttempts).where(eq(publishAttempts.postId, id)),
    );
    expect(seen).toHaveLength(1);
    await expectPgError(
      da.withWorkspace(acme, (tx) =>
        tx
          .insert(publishAttempts)
          .values({ workspaceId: acme.workspaceId, postId: id, attemptNo: 2 }),
      ),
      /permission denied/,
    );
  });

  it('serialises credential access under the row lock', async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstHolds = new Promise<void>((resolve) => (releaseFirst = resolve));
    let firstLocked: () => void = () => undefined;
    const firstHasLock = new Promise<void>((resolve) => (firstLocked = resolve));

    const first = withLockedCredentials(t.owner, acmeAccount, async (locked) => {
      firstLocked();
      order.push('first:locked');
      await firstHolds;
      await locked.save({
        accessTokenEnc: blob('cipher-2'),
        refreshTokenEnc: blob('refresh-2'),
        expiresAt: new Date(Date.now() + 7_200_000),
        scopes: ['atproto'],
        keyVersion: 1,
      });
      order.push('first:saved');
    });
    await firstHasLock;

    const second = withLockedCredentials(t.owner, acmeAccount, async (locked) => {
      order.push('second:locked');
      return locked.row.accessTokenEnc.toString();
    });
    // Give the second transaction time to block on the lock.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(order).toEqual(['first:locked']);

    releaseFirst();
    await first;
    expect(await second).toBe('cipher-2');
    expect(order).toEqual(['first:locked', 'first:saved', 'second:locked']);
  });

  it('marks an account as needing reauth', async () => {
    await withLockedCredentials(t.owner, acmeAccount, (locked) => locked.markNeedsReauth());
    const forVic = await da.withWorkspace(asVic, (tx) => listChannels(tx, acme.workspaceId));
    expect(forVic[0]?.accountStatus).toBe('needs_reauth');
  });
});
