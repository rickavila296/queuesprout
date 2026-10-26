import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDataAccess, retryPost, schema } from '@queuesprout/db';
import { createTestDatabase, type TestDatabase } from '@queuesprout/db/testing';
import type { ProviderId } from '@queuesprout/shared';
import { sendFailureEmails, SETTLE_MS } from './failures';
import type { Email } from './mailer';

const {
  connectedAccounts,
  channels,
  postGroups,
  postItems,
  posts,
  user,
  workspaceMembers,
  workspaces,
} = schema;

describe('failure emails (real Postgres)', () => {
  let t: TestDatabase;
  let sent: Email[];
  let failMail: boolean;
  let ownerId: string;
  let editorId: string;
  let viewerId: string;

  /** Well past the settle window, since Postgres stamps updated_at with its own clock. */
  const later = () => new Date(Date.now() + SETTLE_MS * 2);
  const sweep = (now = later) =>
    sendFailureEmails({
      db: t.owner,
      mail: async (email) => {
        if (failMail) throw new Error('Resend is down');
        sent.push(email);
      },
      publicUrl: 'https://queuesprout.example/',
      now,
      log: { error: () => undefined },
    });

  async function addUser(name: string) {
    const id = randomUUID();
    await t.owner.insert(user).values({ id, email: `${name}@example.com`, name });
    return id;
  }

  async function workspace(isSandbox = false) {
    const slug = `ws-${randomUUID().slice(0, 8)}`;
    const [ws] = await t.owner
      .insert(workspaces)
      .values({ name: 'Acme Coffee', slug, isSandbox, createdBy: ownerId })
      .returning();
    if (!ws) throw new Error('no workspace');
    await t.owner
      .insert(workspaceMembers)
      .values([
        { workspaceId: ws.id, userId: ownerId, role: 'owner' as const },
        { workspaceId: ws.id, userId: editorId, role: 'editor' as const },
        { workspaceId: ws.id, userId: viewerId, role: 'viewer' as const },
      ])
      .onConflictDoNothing();
    return ws;
  }

  async function channel(workspaceId: string, provider: ProviderId, name: string) {
    const [account] = await t.owner
      .insert(connectedAccounts)
      .values({
        workspaceId,
        provider,
        externalAccountId: `ext-${randomUUID()}`,
        displayName: name,
        connectedBy: ownerId,
      })
      .returning();
    if (!account) throw new Error('no account');
    const [row] = await t.owner
      .insert(channels)
      .values({
        workspaceId,
        accountId: account.id,
        provider,
        targetType: 'profile',
        externalTargetId: account.externalAccountId,
        name,
      })
      .returning();
    if (!row) throw new Error('no channel');
    return row;
  }

  /** A group with one failed or published post per channel. */
  async function group(
    workspaceId: string,
    createdBy: string,
    targets: { channelId: string; status: 'failed' | 'published' }[],
  ) {
    const [g] = await t.owner
      .insert(postGroups)
      .values({ workspaceId, createdBy, baseBody: 'Fresh roast drops Friday' })
      .returning();
    if (!g) throw new Error('no group');
    const rows = await t.owner
      .insert(posts)
      .values(
        targets.map(({ channelId, status }) => ({
          workspaceId,
          groupId: g.id,
          channelId,
          status,
          scheduledAt: new Date(),
          ...(status === 'failed' && {
            errorKind: 'transient' as const,
            errorMessage: 'The platform is down.',
          }),
        })),
      )
      .returning();
    await t.owner.insert(postItems).values(
      rows.map((p) => ({
        workspaceId,
        postId: p.id,
        position: 0,
        kind: 'post' as const,
        body: 'Fresh roast drops Friday',
        status: p.status === 'published' ? ('published' as const) : ('failed' as const),
      })),
    );
    return { groupId: g.id, postIds: rows.map((p) => p.id) };
  }

  /** failure_notified_at for each id, in the order given. */
  const notifiedAt = async (ids: string[]) => {
    const rows = await t.owner
      .select({ id: posts.id, at: posts.failureNotifiedAt })
      .from(posts)
      .where(inArray(posts.id, ids));
    return ids.map((id) => rows.find((r) => r.id === id)?.at);
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    ownerId = await addUser('owner');
    editorId = await addUser('editor');
    viewerId = await addUser('viewer');
  });

  afterAll(async () => {
    await t?.drop();
  });

  beforeEach(async () => {
    sent = [];
    failMail = false;
    // Each test starts with nothing left to send.
    await sweep();
    sent = [];
  });

  it('sends one email per group, to its author, listing every failed channel', async () => {
    const ws = await workspace();
    const a = await channel(ws.id, 'bluesky', '@acme.bsky.social');
    const b = await channel(ws.id, 'slack', '#social');
    const c = await channel(ws.id, 'discord', '#news');
    const { groupId, postIds } = await group(ws.id, editorId, [
      { channelId: a.id, status: 'failed' },
      { channelId: b.id, status: 'failed' },
      { channelId: c.id, status: 'published' },
    ]);

    expect(await sweep()).toEqual({ sent: 1, skipped: 0, errors: 0 });
    expect(sent).toHaveLength(1);
    const [email] = sent;
    expect(email?.to).toEqual(['editor@example.com']);
    expect(email?.subject).toBe('Post failed on 2 channels');
    expect(email?.text).toContain('@acme.bsky.social (Bluesky)');
    expect(email?.text).toContain('#social (Slack)');
    expect(email?.text).not.toContain('#news');
    expect(email?.text).toContain(`https://queuesprout.example/w/${ws.slug}/posts/${groupId}`);
    expect(email?.idempotencyKey).toMatch(new RegExp(`^post-failed/${groupId}/\\d+$`));

    const [failedA, failedB, published] = await notifiedAt(postIds);
    expect(failedA).toBeInstanceOf(Date);
    expect(failedB).toBeInstanceOf(Date);
    expect(published).toBeNull();
  });

  it('never emails twice about the same failure', async () => {
    const ws = await workspace();
    const a = await channel(ws.id, 'mastodon', '@acme');
    await group(ws.id, ownerId, [{ channelId: a.id, status: 'failed' }]);
    await sweep();
    await sweep();
    expect(sent).toHaveLength(1);
  });

  it('waits for the group to settle before sending', async () => {
    const ws = await workspace();
    const a = await channel(ws.id, 'telegram', 'Acme channel');
    await group(ws.id, ownerId, [{ channelId: a.id, status: 'failed' }]);
    expect(await sweep(() => new Date())).toEqual({ sent: 0, skipped: 0, errors: 0 });
    await sweep();
    expect(sent).toHaveLength(1);
  });

  it('falls back to owners and admins when the author can no longer act', async () => {
    const ws = await workspace();
    const a = await channel(ws.id, 'bluesky', '@acme');
    await group(ws.id, viewerId, [{ channelId: a.id, status: 'failed' }]);
    await sweep();
    expect(sent[0]?.to).toEqual(['owner@example.com']);
  });

  it('marks sandbox failures without emailing', async () => {
    const ws = await workspace(true);
    const a = await channel(ws.id, 'bluesky', '@demo');
    const { postIds } = await group(ws.id, ownerId, [{ channelId: a.id, status: 'failed' }]);
    expect(await sweep()).toEqual({ sent: 0, skipped: 1, errors: 0 });
    expect(sent).toEqual([]);
    expect((await notifiedAt(postIds))[0]).toBeInstanceOf(Date);
  });

  it('tries again next sweep when sending fails', async () => {
    const ws = await workspace();
    const a = await channel(ws.id, 'slack', '#social');
    const { postIds } = await group(ws.id, ownerId, [{ channelId: a.id, status: 'failed' }]);
    failMail = true;
    expect(await sweep()).toEqual({ sent: 0, skipped: 0, errors: 1 });
    expect((await notifiedAt(postIds))[0]).toBeNull();
    failMail = false;
    expect(await sweep()).toEqual({ sent: 1, skipped: 0, errors: 0 });
  });

  it('emails again when a retried post fails again', async () => {
    const ws = await workspace();
    const a = await channel(ws.id, 'discord', '#news');
    const { postIds } = await group(ws.id, ownerId, [{ channelId: a.id, status: 'failed' }]);
    const postId = postIds[0] ?? '';
    await sweep();
    expect(sent).toHaveLength(1);

    const da = createDataAccess(t.web);
    const asOwner = await da.resolveWorkspace(ownerId, ws.slug);
    if (!asOwner) throw new Error('not a member');
    expect(await da.withWorkspace(asOwner, (tx) => retryPost(tx, postId, false))).toEqual({
      ok: true,
    });
    expect((await notifiedAt(postIds))[0]).toBeNull();

    // The worker fails it again.
    await t.owner
      .update(posts)
      .set({ status: 'failed', errorKind: 'transient', errorMessage: 'Still down.' })
      .where(eq(posts.id, postId));
    await sweep();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.idempotencyKey).not.toBe(sent[0]?.idempotencyKey);
  });
});
