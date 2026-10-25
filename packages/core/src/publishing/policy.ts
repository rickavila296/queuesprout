import type {
  AttemptOutcome,
  ProviderId,
  PublishErrorKind,
  PublishStep,
} from '@queuesprout/shared';

/**
 * What the worker does after one publish step: the retry policy, the processing
 * deadlines and the attempt outcome, as pure functions so they are unit-tested.
 */

/** Transient errors and rate limits retry this many times before the post fails. */
export const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const DEFAULT_RATE_LIMIT_MS = 60_000;

/** How long a platform may process a container before the post fails. */
const PROCESSING_DEADLINE_MS: Partial<Record<ProviderId, number>> = {
  instagram: 30 * 60_000,
  threads: 30 * 60_000,
  tiktok: 60 * 60_000,
  youtube: 2 * 60 * 60_000,
};
const DEFAULT_PROCESSING_DEADLINE_MS = 30 * 60_000;

export function processingDeadline(provider: ProviderId, startedAt: Date): Date {
  const ms = PROCESSING_DEADLINE_MS[provider] ?? DEFAULT_PROCESSING_DEADLINE_MS;
  return new Date(startedAt.getTime() + ms);
}

/** 30 s, 1 min, 2 min, 4 min, 8 min, capped at 15 min. */
export function backoffMs(retriesSoFar: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** retriesSoFar, MAX_BACKOFF_MS);
}

export type StepDecision =
  | { type: 'item_done'; externalId: string; url: string; meta: Record<string, unknown> }
  | { type: 'pending'; nextCheckAt: Date; deadlineAt: Date }
  | { type: 'retry'; runAt: Date; errorKind: PublishErrorKind; message: string }
  | {
      type: 'fail';
      errorKind: PublishErrorKind;
      message: string;
      /** The login is gone: mark the account needs_reauth so every channel shows it. */
      needsReauth: boolean;
      outcome: Extract<AttemptOutcome, 'fatal_error' | 'unknown'>;
    };

export interface DecideInput {
  step: PublishStep;
  provider: ProviderId;
  /** Retryable failures already spent on this post. */
  retriesSoFar: number;
  now: Date;
}

export function decideStep({ step, provider, retriesSoFar, now }: DecideInput): StepDecision {
  if (step.kind === 'done') {
    return { type: 'item_done', externalId: step.externalId, url: step.url, meta: step.meta ?? {} };
  }

  if (step.kind === 'pending') {
    const deadlineAt = processingDeadline(provider, new Date(step.checkpoint.startedAt));
    if (now.getTime() >= deadlineAt.getTime()) {
      return {
        type: 'fail',
        errorKind: 'expired',
        message: 'Platform processing timed out.',
        needsReauth: false,
        outcome: 'fatal_error',
      };
    }
    return {
      type: 'pending',
      nextCheckAt: new Date(now.getTime() + Math.max(step.pollAfterMs, 1000)),
      deadlineAt,
    };
  }

  switch (step.errorKind) {
    case 'transient':
    case 'rate_limit': {
      if (retriesSoFar >= MAX_RETRIES) {
        return {
          type: 'fail',
          errorKind: step.errorKind,
          message: `${step.message} Gave up after ${MAX_RETRIES} retries.`,
          needsReauth: false,
          outcome: 'fatal_error',
        };
      }
      const wait =
        step.errorKind === 'rate_limit'
          ? Math.max(step.retryAfterMs ?? DEFAULT_RATE_LIMIT_MS, backoffMs(retriesSoFar))
          : backoffMs(retriesSoFar);
      return {
        type: 'retry',
        runAt: new Date(now.getTime() + wait),
        errorKind: step.errorKind,
        message: step.message,
      };
    }
    case 'auth':
      return {
        type: 'fail',
        errorKind: 'auth',
        message: step.message,
        needsReauth: true,
        outcome: 'fatal_error',
      };
    case 'unknown':
      // The request may have gone out. A duplicate public post is worse than a failed one.
      return {
        type: 'fail',
        errorKind: 'unknown',
        message: `${step.message} Check the platform before retrying.`,
        needsReauth: false,
        outcome: 'unknown',
      };
    case 'validation':
    case 'expired':
      return {
        type: 'fail',
        errorKind: step.errorKind,
        message: step.message,
        needsReauth: false,
        outcome: 'fatal_error',
      };
  }
}

export function attemptOutcome(decision: StepDecision): AttemptOutcome {
  switch (decision.type) {
    case 'item_done':
      return 'success';
    case 'pending':
      return 'pending';
    case 'retry':
      return 'retryable_error';
    case 'fail':
      return decision.outcome;
  }
}
