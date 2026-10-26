import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptCredentials, parseKeyring } from '@queuesprout/core/credentials';
import { schema } from '@queuesprout/db';
import { accountCredentials } from '@queuesprout/db/schema/credentials';
import { createTestDatabase, type TestDatabase } from '@queuesprout/db/testing';
import { MOCK_TRANSIENT_ONCE } from '@queuesprout/providers';
import type { ProviderId } from '@queuesprout/shared';

/**
 * The Phase 1 exit gate, end to end: the real worker process (pg-boss, dispatcher, publish
 * steps) in mock mode against Postgres. One text post to the 5 open channels publishes
 * within 60 s, the channel hit by a simulated 503 retries and succeeds, and no item is
 * ever sent twice.
 */

const {
  connectedAccounts,
  channels,
  postGroups,
  postItems,
  posts,
  publishAttempts,
  user,
  workspaces,
} = schema;

const CHANNELS: ProviderId[] = ['bluesky', 'mastodon', 'discord', 'telegram', 'slack'];
const GATE_MS = 60_000;
const WORKER_DIR = fileURLToPath(new URL('..', import.meta.url));

describe('Phase 1 exit gate (real worker process, mock publishing)', () => {
  let t: TestDatabase;
  let worker: ChildProcess;
  let workerLog = '';
  const key = randomBytes(32).toString('base64');
  const keyring = parseKeyring(key);

  beforeAll(async () => {
    t = await createTestDatabase();
    worker = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
      cwd: WORKER_DIR,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        PUBLISH_MODE: 'mock',
        WORKER_DATABASE_URL: t.ownerUrl,
        TOKEN_ENCRYPTION_KEY: key,
        MIGRATE_ON_START: 'false',
        LOG_LEVEL: 'info',
        // As .env.example ships it: must not stop the worker (see PR #12).
        RESEND_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout?.on('data', (d: Buffer) => (workerLog += d.toString()));
    worker.stderr?.on('data', (d: Buffer) => (workerLog += d.toString()));
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error(`worker did not start:\n${workerLog}`)),
        30_000,
      );
      const check = setInterval(() => {
        if (workerLog.includes('worker started')) {
          clearTimeout(deadline);
          clearInterval(check);
          resolve();
        }
      }, 100);
      worker.once('exit', (code) => {
        clearTimeout(deadline);
        clearInterval(check);
        reject(new Error(`worker exited (${code}):\n${workerLog}`));
      });
    });
  }, 60_000);

  afterAll(async () => {
    if (worker && worker.exitCode === null) {
      const exited = new Promise((r) => worker.once('exit', r));
      worker.kill('SIGTERM');
      const timer = setTimeout(() => worker.kill('SIGKILL'), 10_000);
      await exited;
      clearTimeout(timer);
    }
    await t?.drop();
  }, 30_000);

  it(
    'publishes one text post to all 5 channels within 60 s, retries a 503, never posts twice',
    async () => {
      const ownerId = randomUUID();
      await t.owner.insert(user).values({ id: ownerId, email: 'gate@example.com', name: 'Gate' });
      // Not a sandbox: PUBLISH_MODE=mock alone must keep it off the platforms.
      const [ws] = await t.owner
        .insert(workspaces)
        .values({ name: 'Gate', slug: 'gate', isSandbox: false, createdBy: ownerId })
        .returning();
      if (!ws) throw new Error('no workspace');

      const channelIds = new Map<ProviderId, string>();
      for (const provider of CHANNELS) {
        const externalAccountId = `ext-${randomUUID()}`;
        const [account] = await t.owner
          .insert(connectedAccounts)
          .values({
            workspaceId: ws.id,
            provider,
            externalAccountId,
            displayName: provider,
            connectedBy: ownerId,
          })
          .returning();
        if (!account) throw new Error('no account');
        const enc = encryptCredentials(
          keyring,
          { workspaceId: ws.id, provider, externalAccountId },
          { accessToken: 'access', refreshToken: null, expiresAt: null, scopes: [] },
        );
        await t.owner.insert(accountCredentials).values({ accountId: account.id, ...enc });
        const [channel] = await t.owner
          .insert(channels)
          .values({
            workspaceId: ws.id,
            accountId: account.id,
            provider,
            targetType: 'profile',
            externalTargetId: externalAccountId,
            name: provider,
          })
          .returning();
        if (!channel) throw new Error('no channel');
        channelIds.set(provider, channel.id);
      }

      // "Publish now": scheduled for this moment, like the composer saves it.
      const scheduledAt = new Date();
      const [group] = await t.owner
        .insert(postGroups)
        .values({ workspaceId: ws.id, createdBy: ownerId, baseBody: 'Exit gate' })
        .returning();
      if (!group) throw new Error('no group');
      const postIds = new Map<ProviderId, string>();
      for (const provider of CHANNELS) {
        const [post] = await t.owner
          .insert(posts)
          .values({
            workspaceId: ws.id,
            groupId: group.id,
            channelId: channelIds.get(provider) ?? '',
            status: 'scheduled',
            scheduledAt,
          })
          .returning();
        if (!post) throw new Error('no post');
        postIds.set(provider, post.id);
        await t.owner.insert(postItems).values({
          workspaceId: ws.id,
          postId: post.id,
          position: 0,
          kind: 'post',
          // Slack answers with a 503 the first time.
          body: provider === 'slack' ? `Exit gate ${MOCK_TRANSIENT_ONCE}` : 'Exit gate',
        });
      }

      const ids = [...postIds.values()];
      const loadPosts = () =>
        t.owner
          .select({
            id: posts.id,
            status: posts.status,
            publishedAt: posts.publishedAt,
            externalUrl: posts.externalUrl,
          })
          .from(posts)
          .where(inArray(posts.id, ids));

      let rows = await loadPosts();
      while (Date.now() - scheduledAt.getTime() < GATE_MS + 15_000) {
        rows = await loadPosts();
        if (rows.every((r) => r.status === 'published' || r.status === 'failed')) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      const report = rows.map((r) => ({
        provider: [...postIds].find(([, id]) => id === r.id)?.[0],
        status: r.status,
        seconds: r.publishedAt ? (r.publishedAt.getTime() - scheduledAt.getTime()) / 1000 : null,
      }));
      expect(
        report.every((r) => r.status === 'published'),
        JSON.stringify(report),
      ).toBe(true);
      for (const r of rows) {
        expect(r.publishedAt?.getTime() ?? Infinity).toBeLessThan(scheduledAt.getTime() + GATE_MS);
        // Mock mode: links to the preview page, never a platform.
        expect(r.externalUrl).toMatch(/^http:\/\/localhost:3000\/mock\/posts\/mock_/);
      }

      // Each item went out exactly once; Slack's 503 shows up as one retryable attempt.
      const attempts = await t.owner
        .select({ postId: publishAttempts.postId, outcome: publishAttempts.outcome })
        .from(publishAttempts)
        .where(inArray(publishAttempts.postId, ids));
      for (const [provider, id] of postIds) {
        const outcomes = attempts.filter((a) => a.postId === id).map((a) => a.outcome);
        expect(outcomes, provider).toEqual(
          provider === 'slack' ? ['retryable_error', 'success'] : ['success'],
        );
      }
      const [slackItem] = await t.owner
        .select({ status: postItems.status, externalId: postItems.externalId })
        .from(postItems)
        .where(eq(postItems.postId, postIds.get('slack') ?? ''));
      expect(slackItem).toMatchObject({
        status: 'published',
        externalId: expect.stringMatching(/^mock_slack_/),
      });
      expect(workerLog).not.toMatch(/"level":(50|60)|ERROR|FATAL/);
    },
    GATE_MS + 30_000,
  );
});
