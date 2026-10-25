import { describe, expect, it, vi } from 'vitest';
import type { PublishStep } from '@queuesprout/shared';
import { BASE_DEFINITIONS } from '../definitions';
import { buildPublishContext, runUntilSettled, TEST_NOW } from '../testing';
import { createMockAdapter, demoAccount, findMockFailure } from './mock-adapter';

const instant = { publicUrl: 'http://localhost:3000/', wait: async () => undefined };

describe('mock adapter', () => {
  it('publishes a text post as done with a mock id and preview url', async () => {
    const adapter = createMockAdapter(BASE_DEFINITIONS.bluesky, instant);
    const step = await adapter.publish(buildPublishContext());
    expect(step).toMatchObject({ kind: 'done', meta: { mock: true } });
    if (step.kind !== 'done') return;
    expect(step.externalId).toMatch(/^mock_bluesky_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(step.url).toBe(`http://localhost:3000/mock/posts/${step.externalId}`);
  });

  it('points replies at their parent and root', async () => {
    const adapter = createMockAdapter(BASE_DEFINITIONS.bluesky, instant);
    const ref = { externalId: 'mock_bluesky_root', url: null, meta: {} };
    const step = await adapter.publish(
      buildPublishContext({ bodies: ['one', 'two'], position: 1, parent: ref, root: ref }),
    );
    expect(step).toMatchObject({
      kind: 'done',
      meta: { replyTo: 'mock_bluesky_root', root: 'mock_bluesky_root' },
    });
  });

  it('waits a simulated 300-1,500 ms, inside the step deadline', async () => {
    const wait = vi.fn(async () => undefined);
    const adapter = createMockAdapter(BASE_DEFINITIONS.mastodon, {
      ...instant,
      wait,
      random: () => 0.999,
    });
    await adapter.publish(buildPublishContext({ provider: 'mastodon' }));
    const ms = (wait.mock.calls[0] as unknown[] | undefined)?.[0];
    expect(ms).toBeGreaterThanOrEqual(300);
    expect(ms).toBeLessThanOrEqual(1500);
  });

  it('returns a transient error when the step deadline fires', async () => {
    const adapter = createMockAdapter(BASE_DEFINITIONS.bluesky, {
      publicUrl: 'http://x',
      latencyMs: { min: 10_000, max: 10_000 },
    });
    const controller = new AbortController();
    const pending = adapter.publish(buildPublishContext({ signal: controller.signal }));
    controller.abort(new Error('deadline'));
    expect(await pending).toMatchObject({ kind: 'error', errorKind: 'transient' });
  });

  it('runs the real validator, so mock posts fail like live ones', async () => {
    const adapter = createMockAdapter(BASE_DEFINITIONS.bluesky, instant);
    const step = await adapter.publish(buildPublishContext({ bodies: ['x'.repeat(301)] }));
    expect(step).toMatchObject({ kind: 'error', errorKind: 'validation' });
  });

  it('runs the real settings schema (Pinterest needs a board)', async () => {
    const adapter = createMockAdapter(BASE_DEFINITIONS.pinterest, instant);
    const missing = await adapter.publish(buildPublishContext({ provider: 'pinterest' }));
    expect(missing).toMatchObject({
      kind: 'error',
      errorKind: 'validation',
      message: 'Choose a board.',
    });
    const ok = await adapter.publish(
      buildPublishContext({ provider: 'pinterest', settings: { board_id: 'b1' } }),
    );
    expect(ok.kind).toBe('done');
  });

  describe('failure injection', () => {
    it.each([
      ['[[mock:rate_limit]]', 'rate_limit', 60_000],
      ['[[mock:auth]]', 'auth', undefined],
      ['[[mock:transient]]', 'transient', undefined],
      ['[[mock:timeout]]', 'unknown', undefined],
    ] as const)('%s returns %s', async (marker, errorKind, retryAfterMs) => {
      const adapter = createMockAdapter(BASE_DEFINITIONS.bluesky, instant);
      const step = await adapter.publish(buildPublishContext({ bodies: [`hello ${marker}`] }));
      expect(step).toMatchObject({ kind: 'error', errorKind });
      if (step.kind === 'error') expect(step.retryAfterMs).toBe(retryAfterMs);
    });

    it('fails only the item that carries the marker', async () => {
      const adapter = createMockAdapter(BASE_DEFINITIONS.bluesky, instant);
      const bodies = ['fine', 'boom [[mock:transient]]'];
      expect((await adapter.publish(buildPublishContext({ bodies }))).kind).toBe('done');
      const second = await adapter.publish(buildPublishContext({ bodies, position: 1 }));
      expect(second.kind).toBe('error');
    });

    it('ignores text that only looks similar', () => {
      expect(findMockFailure('[mock:auth] and [[mock:nope]]')).toBeNull();
    });
  });

  describe('async providers', () => {
    const isPending = (s: PublishStep) => s.kind === 'pending';

    it.each([
      [0.1, 1],
      [0.9, 2],
    ])('with random %d goes pending %d time(s), then done', async (r, pendings) => {
      const adapter = createMockAdapter(BASE_DEFINITIONS.instagram, {
        ...instant,
        random: () => r,
      });
      const steps = await runUntilSettled(adapter, buildPublishContext({ provider: 'instagram' }));
      expect(steps.filter(isPending)).toHaveLength(pendings);
      expect(steps.at(-1)?.kind).toBe('done');
    });

    it('records the container and start time in the first checkpoint', async () => {
      const adapter = createMockAdapter(BASE_DEFINITIONS.threads, instant);
      const step = await adapter.publish(buildPublishContext({ provider: 'threads' }));
      expect(step).toMatchObject({
        kind: 'pending',
        pollAfterMs: 1000,
        checkpoint: { stage: 'container_created', startedAt: TEST_NOW.toISOString() },
      });
    });

    it('never creates a second container when resuming from a checkpoint', async () => {
      const adapter = createMockAdapter(BASE_DEFINITIONS.tiktok, { ...instant, random: () => 0.9 });
      const steps = await runUntilSettled(adapter, buildPublishContext({ provider: 'tiktok' }));
      const containers = new Set(
        steps.flatMap((s) => (s.kind === 'pending' ? [s.checkpoint.containerId] : [])),
      );
      expect(containers.size).toBe(1);
      const done = steps.at(-1);
      expect(done?.kind === 'done' && done.meta?.containerId).toBe([...containers][0]);
    });

    it('resumes from a saved checkpoint after a worker restart', async () => {
      const adapter = createMockAdapter(BASE_DEFINITIONS.youtube, instant);
      const step = await adapter.publish(
        buildPublishContext({
          provider: 'youtube',
          checkpoint: {
            stage: 'container_created',
            containerId: 'mock_container_saved',
            startedAt: TEST_NOW.toISOString(),
            data: { checksLeft: 1 },
          },
        }),
      );
      expect(step).toMatchObject({ kind: 'done', meta: { containerId: 'mock_container_saved' } });
    });
  });

  it('refreshes tokens and connects demo accounts without any platform call', async () => {
    const adapter = createMockAdapter(BASE_DEFINITIONS.linkedin, instant);
    const fresh = await adapter.refreshToken(
      buildPublishContext().creds,
      new AbortController().signal,
    );
    expect(fresh.accessToken).toMatch(/^mock-access-/);
    const demo = demoAccount('pinterest');
    expect(demo.targets[0]).toMatchObject({
      targetType: 'account',
      defaultSettings: { board_id: 'mock_board' },
    });
  });
});
