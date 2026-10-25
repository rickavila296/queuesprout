import { describe, expect, it } from 'vitest';
import type { PublishStep } from '@queuesprout/shared';
import { MAX_RETRIES, attemptOutcome, backoffMs, decideStep, processingDeadline } from './policy';

const now = new Date('2026-10-25T12:00:00Z');
const at = (ms: number) => new Date(now.getTime() + ms);
const err = (errorKind: Extract<PublishStep, { kind: 'error' }>['errorKind'], extra = {}) =>
  ({ kind: 'error', errorKind, message: 'boom', ...extra }) as PublishStep;

describe('backoffMs', () => {
  it('doubles from 30 s and caps at 15 min', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(backoffMs)).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000,
    ]);
  });
});

describe('decideStep', () => {
  const base = { provider: 'bluesky' as const, retriesSoFar: 0, now };

  it('records a done item', () => {
    const d = decideStep({ ...base, step: { kind: 'done', externalId: 'x', url: 'u' } });
    expect(d).toEqual({ type: 'item_done', externalId: 'x', url: 'u', meta: {} });
    expect(attemptOutcome(d)).toBe('success');
  });

  it('schedules the next status check and the deadline for pending steps', () => {
    const d = decideStep({
      ...base,
      provider: 'instagram',
      step: {
        kind: 'pending',
        pollAfterMs: 5000,
        checkpoint: { stage: 'container_created', startedAt: now.toISOString() },
      },
    });
    expect(d).toEqual({ type: 'pending', nextCheckAt: at(5000), deadlineAt: at(30 * 60_000) });
  });

  it('never polls faster than once a second', () => {
    const d = decideStep({
      ...base,
      step: {
        kind: 'pending',
        pollAfterMs: 0,
        checkpoint: { stage: 's', startedAt: now.toISOString() },
      },
    });
    expect(d).toMatchObject({ nextCheckAt: at(1000) });
  });

  it.each([
    ['instagram', 30],
    ['threads', 30],
    ['tiktok', 60],
    ['youtube', 120],
  ] as const)('fails %s processing after %d minutes', (provider, minutes) => {
    expect(processingDeadline(provider, now)).toEqual(at(minutes * 60_000));
    const started = new Date(now.getTime() - minutes * 60_000).toISOString();
    const d = decideStep({
      ...base,
      provider,
      step: { kind: 'pending', pollAfterMs: 1000, checkpoint: { stage: 's', startedAt: started } },
    });
    expect(d).toMatchObject({
      type: 'fail',
      errorKind: 'expired',
      message: 'Platform processing timed out.',
    });
  });

  it('retries transient errors with backoff', () => {
    expect(decideStep({ ...base, retriesSoFar: 2, step: err('transient') })).toEqual({
      type: 'retry',
      runAt: at(120_000),
      errorKind: 'transient',
      message: 'boom',
    });
  });

  it('honours Retry-After on rate limits, but never retries sooner than the backoff', () => {
    expect(
      decideStep({ ...base, step: err('rate_limit', { retryAfterMs: 90_000 }) }),
    ).toMatchObject({
      runAt: at(90_000),
    });
    expect(
      decideStep({ ...base, retriesSoFar: 4, step: err('rate_limit', { retryAfterMs: 1000 }) }),
    ).toMatchObject({ runAt: at(480_000) });
    expect(decideStep({ ...base, step: err('rate_limit') })).toMatchObject({ runAt: at(60_000) });
  });

  it(`fails after ${MAX_RETRIES} retries`, () => {
    const d = decideStep({ ...base, retriesSoFar: MAX_RETRIES, step: err('transient') });
    expect(d).toMatchObject({ type: 'fail', errorKind: 'transient', needsReauth: false });
    expect(attemptOutcome(d)).toBe('fatal_error');
  });

  it('stops and asks for reauth on auth errors', () => {
    expect(decideStep({ ...base, step: err('auth') })).toMatchObject({
      type: 'fail',
      needsReauth: true,
    });
  });

  it('never retries an unknown outcome', () => {
    const d = decideStep({ ...base, step: err('unknown') });
    expect(d).toMatchObject({ type: 'fail', errorKind: 'unknown' });
    expect(d.type === 'fail' && d.message).toContain('Check the platform');
    expect(attemptOutcome(d)).toBe('unknown');
  });

  it.each(['validation', 'expired'] as const)('fails %s errors at once', (kind) => {
    expect(decideStep({ ...base, step: err(kind) })).toMatchObject({
      type: 'fail',
      errorKind: kind,
    });
  });
});
