import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findPgError } from './errors';
import { createDataAccess, type DataAccess, type WorkspaceContext } from './context';
import {
  consumeOAuthSession,
  createOAuthSession,
  findProviderApp,
  providerAppForSession,
  saveProviderApp,
} from './queries/oauth';
import { createWorkspace } from './queries/workspaces';
import { oauthSessions, user, workspaceMembers } from './schema';
import { createTestDatabase, type TestDatabase } from './test-utils';

const INSTANCE = 'https://masto.test';

async function expectPgError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, 'expected the query to fail').not.toBeNull();
  expect(findPgError(error)?.message).toMatch(pattern);
}

describe('provider apps and OAuth sessions', () => {
  let t: TestDatabase;
  let da: DataAccess;
  const alice = { id: randomUUID(), email: 'alice@example.com', name: 'Alice' }; // owner of acme
  const ed = { id: randomUUID(), email: 'ed@example.com', name: 'Ed' }; // editor in acme
  const eve = { id: randomUUID(), email: 'eve@example.com', name: 'Eve' }; // owner of evil
  let acme: WorkspaceContext;
  let asEd: WorkspaceContext;
  let evil: WorkspaceContext;
  let appId: string;

  const ctx = async (userId: string, slug: string) => {
    const c = await da.resolveWorkspace(userId, slug);
    if (!c) throw new Error(`${userId} is not a member of ${slug}`);
    return c;
  };

  const save = (c: WorkspaceContext, clientId: string) =>
    da.withWorkspace(c, (tx) =>
      saveProviderApp(tx, {
        workspaceId: c.workspaceId,
        provider: 'mastodon',
        instanceUrl: INSTANCE,
        clientId,
        clientSecretEnc: Buffer.from(`secret-${clientId}`),
        keyVersion: 1,
      }),
    );

  const startSession = (c: WorkspaceContext, userId: string, stateHash: string) =>
    da.withWorkspace(c, (tx) =>
      createOAuthSession(tx, {
        stateHash,
        userId,
        workspaceId: c.workspaceId,
        provider: 'mastodon',
        providerAppId: appId,
        codeVerifierEnc: Buffer.from('verifier'),
        keyVersion: 1,
        redirectTo: '/w/acme/channels',
      }),
    );

  beforeAll(async () => {
    t = await createTestDatabase();
    da = createDataAccess(t.web);
    await t.web.insert(user).values([alice, ed, eve]);
    await da.withUser(alice.id, (tx) =>
      createWorkspace(tx, { name: 'Acme', slug: 'acme', timezone: 'UTC' }),
    );
    await da.withUser(eve.id, (tx) =>
      createWorkspace(tx, { name: 'Evil', slug: 'evil', timezone: 'UTC' }),
    );
    acme = await ctx(alice.id, 'acme');
    evil = await ctx(eve.id, 'evil');
    await t.owner
      .insert(workspaceMembers)
      .values({ workspaceId: acme.workspaceId, userId: ed.id, role: 'editor' });
    asEd = await ctx(ed.id, 'acme');
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('stores one app per instance, shared by every workspace', async () => {
    const first = await save(acme, 'client-a');
    appId = first.id;
    expect(first).toMatchObject({ instanceUrl: INSTANCE, clientId: 'client-a' });
    // A second registration (another workspace, or a race) keeps the first app.
    expect(await save(evil, 'client-b')).toEqual(first);
    const found = await da.withWorkspace(evil, (tx) =>
      findProviderApp(tx, {
        workspaceId: evil.workspaceId,
        provider: 'mastodon',
        instanceUrl: INSTANCE,
      }),
    );
    expect(found?.clientSecretEnc.toString()).toBe('secret-client-a');
  });

  it('lets only admins read or register apps, and never reads the table directly', async () => {
    await expectPgError(save(asEd, 'client-ed'), /forbidden/);
    await expectPgError(
      da.withWorkspace(asEd, (tx) =>
        findProviderApp(tx, {
          workspaceId: acme.workspaceId,
          provider: 'mastodon',
          instanceUrl: INSTANCE,
        }),
      ),
      /forbidden/,
    );
    // Eve is an admin, but not of acme.
    await expectPgError(
      da.withWorkspace(evil, (tx) =>
        findProviderApp(tx, {
          workspaceId: acme.workspaceId,
          provider: 'mastodon',
          instanceUrl: INSTANCE,
        }),
      ),
      /forbidden/,
    );
    await expectPgError(
      da.withWorkspace(acme, (tx) => tx.execute(sql`select * from provider_apps`)),
      /permission denied/,
    );
  });

  it('refuses instance addresses that are not a bare https origin', async () => {
    await expectPgError(
      da.withWorkspace(acme, (tx) =>
        saveProviderApp(tx, {
          workspaceId: acme.workspaceId,
          provider: 'mastodon',
          instanceUrl: 'http://masto.test/path',
          clientId: 'x',
          clientSecretEnc: Buffer.from('x'),
          keyVersion: 1,
        }),
      ),
      /invalid_instance_url/,
    );
  });

  it('consumes a session once, only for the user who started it', async () => {
    const sessionId = await startSession(acme, alice.id, 'hash-1');

    // Eve cannot see or use Alice's session.
    expect(await da.withWorkspace(evil, (tx) => consumeOAuthSession(tx, 'hash-1'))).toBeNull();
    expect(await da.withWorkspace(evil, (tx) => providerAppForSession(tx, sessionId))).toBeNull();

    const session = await da.withWorkspace(acme, (tx) => consumeOAuthSession(tx, 'hash-1'));
    expect(session).toMatchObject({
      id: sessionId,
      providerAppId: appId,
      redirectTo: '/w/acme/channels',
    });
    expect(session?.codeVerifierEnc?.toString()).toBe('verifier');
    const app = await da.withWorkspace(acme, (tx) => providerAppForSession(tx, sessionId));
    expect(app?.clientId).toBe('client-a');

    // A replayed callback finds nothing.
    expect(await da.withWorkspace(acme, (tx) => consumeOAuthSession(tx, 'hash-1'))).toBeNull();
  });

  it('ignores expired sessions', async () => {
    const sessionId = await startSession(acme, alice.id, 'hash-old');
    await t.owner.execute(
      sql`update ${oauthSessions} set expires_at = now() - interval '1 minute' where id = ${sessionId}`,
    );
    expect(await da.withWorkspace(acme, (tx) => consumeOAuthSession(tx, 'hash-old'))).toBeNull();
    expect(await da.withWorkspace(acme, (tx) => providerAppForSession(tx, sessionId))).toBeNull();
  });

  it('lets only admins start a connect flow', async () => {
    await expectPgError(startSession(asEd, ed.id, 'hash-ed'), /row-level security/);
    // Nor in someone else's name.
    await expectPgError(startSession(acme, ed.id, 'hash-spoof'), /row-level security/);
  });
});
