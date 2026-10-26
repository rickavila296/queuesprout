import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDataAccess, type DataAccess } from './context';
import {
  acceptInvite,
  createInvite,
  createWorkspace,
  getInvitePreview,
  listMembers,
  listMyWorkspaces,
  listOpenInvites,
  removeMember,
  updateMemberRole,
} from './queries/workspaces';
import { profiles, user, workspaceInvites, workspaceMembers, workspaces } from './schema';
import { createTestDatabase, type TestDatabase } from './test-utils';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

describe('tenancy and RLS', () => {
  let t: TestDatabase;
  let da: DataAccess;
  const alice = { id: randomUUID(), email: 'alice@example.com', name: 'Alice' };
  const bob = { id: randomUUID(), email: 'bob@example.com', name: '' };
  const eve = { id: randomUUID(), email: 'eve@example.com', name: 'Eve' };

  beforeAll(async () => {
    t = await createTestDatabase();
    da = createDataAccess(t.web);
    // Sign-up is Better Auth's job; insert users directly as it would.
    await t.web.insert(user).values([alice, bob, eve]);
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('creates a profile for every new user', async () => {
    const rows = await t.owner.select().from(profiles);
    expect(rows.map((p) => p.displayName).sort()).toEqual(['Alice', 'Eve', 'bob']);
  });

  it('creates a workspace with its owner membership', async () => {
    const result = await da.withUser(alice.id, (tx) =>
      createWorkspace(tx, { name: 'Acme', slug: 'acme', timezone: 'Europe/London' }),
    );
    expect(result.ok).toBe(true);
    const mine = await da.withUser(alice.id, (tx) => listMyWorkspaces(tx, alice.id));
    expect(mine).toEqual([expect.objectContaining({ slug: 'acme', role: 'owner' })]);
  });

  it('reports a taken slug without leaking the other tenant', async () => {
    const result = await da.withUser(eve.id, (tx) =>
      createWorkspace(tx, { name: 'Copy', slug: 'acme', timezone: 'UTC' }),
    );
    expect(result).toEqual({ ok: false, error: 'slug_taken' });
  });

  it('hides workspaces from non-members and from callers with no user set', async () => {
    const asEve = await da.withUser(eve.id, (tx) => tx.select().from(workspaces));
    expect(asEve).toEqual([]);
    const anonymous = await t.web.select().from(workspaces);
    expect(anonymous).toEqual([]);
    expect(await da.resolveWorkspace(eve.id, 'acme')).toBeNull();
  });

  it('refuses direct inserts that bypass app.create_workspace', async () => {
    await expect(
      da.withUser(eve.id, (tx) => tx.insert(workspaces).values({ name: 'X', slug: 'x' })),
    ).rejects.toThrow();
  });

  it('runs the invite flow end to end', async () => {
    const ctx = await da.resolveWorkspace(alice.id, 'acme');
    expect(ctx?.role).toBe('owner');
    if (!ctx) return;

    const token = 'bob-token';
    await da.withWorkspace(ctx, (tx) =>
      createInvite(tx, {
        workspaceId: ctx.workspaceId,
        invitedBy: alice.id,
        email: 'Bob@Example.com',
        role: 'viewer',
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
    const open = await da.withWorkspace(ctx, (tx) => listOpenInvites(tx, ctx.workspaceId));
    expect(open).toEqual([expect.objectContaining({ email: 'bob@example.com', role: 'viewer' })]);

    const preview = await da.withUser(bob.id, (tx) => getInvitePreview(tx, hash(token)));
    expect(preview).toMatchObject({ workspaceName: 'Acme', role: 'viewer', accepted: false });

    // Someone else holding the link cannot use it.
    const stolen = await da.withUser(eve.id, (tx) => acceptInvite(tx, hash(token)));
    expect(stolen).toEqual({ ok: false, error: 'invite_email_mismatch' });

    const accepted = await da.withUser(bob.id, (tx) => acceptInvite(tx, hash(token)));
    expect(accepted).toEqual({ ok: true, workspaceSlug: 'acme' });

    const again = await da.withUser(bob.id, (tx) => acceptInvite(tx, hash(token)));
    expect(again).toEqual({ ok: false, error: 'invite_invalid' });

    const bobCtx = await da.resolveWorkspace(bob.id, 'acme');
    expect(bobCtx?.role).toBe('viewer');
    if (!bobCtx) return;
    const members = await da.withWorkspace(bobCtx, (tx) => listMembers(tx, bobCtx.workspaceId));
    expect(members.map((m) => [m.email, m.role])).toEqual([
      ['alice@example.com', 'owner'],
      ['bob@example.com', 'viewer'],
    ]);
  });

  it('enforces roles in the database, not just the UI', async () => {
    const bobCtx = await da.resolveWorkspace(bob.id, 'acme');
    if (!bobCtx) throw new Error('bob should be a member');

    // Viewers cannot invite.
    await expect(
      da.withWorkspace(bobCtx, (tx) =>
        createInvite(tx, {
          workspaceId: bobCtx.workspaceId,
          invitedBy: bob.id,
          email: 'mallory@example.com',
          role: 'admin',
          tokenHash: hash('m'),
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      ),
    ).rejects.toThrow();

    // Viewers cannot see invites or rename the workspace.
    const invites = await da.withWorkspace(bobCtx, (tx) => tx.select().from(workspaceInvites));
    expect(invites).toEqual([]);
    const renamed = await da.withWorkspace(bobCtx, (tx) =>
      tx
        .update(workspaces)
        .set({ name: 'Pwned' })
        .where(sql`true`)
        .returning(),
    );
    expect(renamed).toEqual([]);

    // Viewers cannot promote themselves.
    const promoted = await da.withWorkspace(bobCtx, (tx) =>
      tx.execute(sql`update workspace_members set role = 'owner' where user_id = ${bob.id}`),
    );
    expect(promoted.rowCount).toBe(0);
  });

  it('never grants ownership through an invite', async () => {
    const ctx = await da.resolveWorkspace(alice.id, 'acme');
    if (!ctx) throw new Error('alice should own acme');
    await expect(
      da.withWorkspace(ctx, (tx) =>
        tx.insert(workspaceInvites).values({
          workspaceId: ctx.workspaceId,
          invitedBy: alice.id,
          email: 'owner2@example.com',
          role: 'owner',
          tokenHash: hash('o'),
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      ),
    ).rejects.toThrow();
  });

  it("changes the role of a member who accepts a second invite, but never the owner's", async () => {
    const ctx = await da.resolveWorkspace(alice.id, 'acme');
    if (!ctx) throw new Error('alice should own acme');
    const invite = (email: string, token: string) =>
      da.withWorkspace(ctx, (tx) =>
        createInvite(tx, {
          workspaceId: ctx.workspaceId,
          invitedBy: alice.id,
          email,
          role: 'admin',
          tokenHash: hash(token),
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      );

    await invite(bob.email, 'bob-admin');
    expect(await da.withUser(bob.id, (tx) => acceptInvite(tx, hash('bob-admin')))).toEqual({
      ok: true,
      workspaceSlug: 'acme',
    });
    expect((await da.resolveWorkspace(bob.id, 'acme'))?.role).toBe('admin');

    // Bob, now admin, invites Alice as admin: accepting must not demote the owner.
    const bobCtx = await da.resolveWorkspace(bob.id, 'acme');
    if (!bobCtx) throw new Error('bob should be a member');
    await da.withWorkspace(bobCtx, (tx) =>
      createInvite(tx, {
        workspaceId: bobCtx.workspaceId,
        invitedBy: bob.id,
        email: alice.email,
        role: 'admin',
        tokenHash: hash('alice-admin'),
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
    await da.withUser(alice.id, (tx) => acceptInvite(tx, hash('alice-admin')));
    expect((await da.resolveWorkspace(alice.id, 'acme'))?.role).toBe('owner');

    await da.withWorkspace(ctx, (tx) => updateMemberRole(tx, ctx.workspaceId, bob.id, 'viewer'));
  });

  it('lets admins change roles and remove members, but never the owner', async () => {
    const ctx = await da.resolveWorkspace(alice.id, 'acme');
    if (!ctx) throw new Error('alice should own acme');
    await t.owner
      .insert(workspaceMembers)
      .values({ workspaceId: ctx.workspaceId, userId: eve.id, role: 'admin' });
    const eveCtx = await da.resolveWorkspace(eve.id, 'acme');
    const bobCtx = await da.resolveWorkspace(bob.id, 'acme');
    if (!eveCtx || !bobCtx) throw new Error('eve and bob should be members');

    // A viewer can do neither.
    expect(
      await da.withWorkspace(bobCtx, (tx) =>
        updateMemberRole(tx, ctx.workspaceId, eve.id, 'viewer'),
      ),
    ).toBe(false);
    expect(await da.withWorkspace(bobCtx, (tx) => removeMember(tx, ctx.workspaceId, eve.id))).toBe(
      false,
    );

    // An admin can, except on the owner.
    expect(
      await da.withWorkspace(eveCtx, (tx) =>
        updateMemberRole(tx, ctx.workspaceId, bob.id, 'editor'),
      ),
    ).toBe(true);
    expect((await da.resolveWorkspace(bob.id, 'acme'))?.role).toBe('editor');
    expect(
      await da.withWorkspace(eveCtx, (tx) =>
        updateMemberRole(tx, ctx.workspaceId, alice.id, 'viewer'),
      ),
    ).toBe(false);
    expect(
      await da.withWorkspace(eveCtx, (tx) => removeMember(tx, ctx.workspaceId, alice.id)),
    ).toBe(false);
    expect(await da.withWorkspace(eveCtx, (tx) => removeMember(tx, ctx.workspaceId, bob.id))).toBe(
      true,
    );
    expect(await da.resolveWorkspace(bob.id, 'acme')).toBeNull();
    expect((await da.resolveWorkspace(alice.id, 'acme'))?.role).toBe('owner');
  });

  it('keeps app.user_id local to its transaction', async () => {
    await da.withUser(alice.id, async () => undefined);
    const leaked = await t.web.execute<{ id: string | null }>(
      sql`select app.current_user_id() as id`,
    );
    expect(leaked.rows[0]?.id).toBeNull();
  });
});
