import { getFreshToken, type Keyring } from '@queuesprout/core/credentials';
import { attemptOutcome, decideStep, type StepDecision } from '@queuesprout/core/publishing';
import type { Database } from '@queuesprout/db';
import {
  beginStep,
  finishStep,
  type FollowUp,
  type StepResult,
  type StepWork,
} from '@queuesprout/db/publishing';
import { redact, type AdapterResolution, type PublishContext } from '@queuesprout/providers';
import type { ProviderId, PublishStep, TargetType } from '@queuesprout/shared';
import { createCredentialStore } from '../credentials';

/** Each publish step must finish inside this, so no worker slot ever waits on a platform. */
export const STEP_TIMEOUT_MS = 60_000;
const REFRESH_TIMEOUT_MS = 30_000;

export interface StepLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface PipelineDeps {
  db: Database;
  keyring: Keyring;
  pickAdapter(selection: { provider: ProviderId; workspaceIsSandbox: boolean }): AdapterResolution;
  now(): Date;
  log: StepLogger;
  stepTimeoutMs?: number;
}

function toResult(decision: StepDecision, step: PublishStep): StepResult {
  if (decision.type === 'pending') {
    if (step.kind !== 'pending') throw new Error('pending decision without a pending step');
    return { ...decision, checkpoint: step.checkpoint };
  }
  if (decision.type === 'fail') {
    const { outcome: _outcome, ...rest } = decision;
    return rest;
  }
  return decision;
}

/** Applies a synthetic step (refresh failure, missing adapter) through the same policy. */
async function finishWith(
  deps: PipelineDeps,
  work: StepWork,
  step: PublishStep,
): Promise<FollowUp> {
  const now = deps.now();
  const decision = decideStep({
    step,
    provider: work.provider,
    retriesSoFar: work.retriesSoFar,
    now,
  });
  return finishStep(deps.db, {
    work,
    result: toResult(decision, step),
    outcome: attemptOutcome(decision),
    now,
    response: step.kind === 'error' && step.raw !== undefined ? redact(step.raw) : null,
  });
}

/**
 * Runs one bounded publish step for a post (the publish.step job). Loads the next
 * unpublished item, gets a fresh token under the credentials row lock, calls the
 * adapter once, and records the result. Returns what should run next.
 */
export async function runStep(deps: PipelineDeps, postId: string): Promise<FollowUp> {
  const begun = await beginStep(deps.db, postId, deps.now());
  if (begun.kind !== 'work') {
    deps.log.info({ postId, result: begun.kind }, 'publish step skipped');
    return { next: 'none' };
  }
  const work = begun.work;

  const resolved = deps.pickAdapter({
    provider: work.provider,
    workspaceIsSandbox: work.workspaceIsSandbox,
  });
  if (!resolved.ok) {
    return finishWith(deps, work, {
      kind: 'error',
      errorKind: 'validation',
      message: `Publishing to ${work.provider} is not available yet.`,
    });
  }
  const { adapter, mock } = resolved;
  const accountRef = {
    externalId: work.account.externalAccountId,
    serviceUrl: work.account.serviceUrl,
  };

  let fresh: Awaited<ReturnType<typeof getFreshToken>>;
  try {
    fresh = await getFreshToken({
      store: createCredentialStore(deps.db),
      keyring: deps.keyring,
      accountId: work.account.id,
      account: {
        workspaceId: work.workspaceId,
        provider: work.provider,
        externalAccountId: work.account.externalAccountId,
      },
      refresh: (creds) =>
        adapter.refreshToken(creds, AbortSignal.timeout(REFRESH_TIMEOUT_MS), accountRef),
      now: deps.now,
    });
  } catch (error) {
    // Undecryptable or missing credentials: only reconnecting fixes it. Never log the blob.
    deps.log.warn({ postId, err: (error as Error).name }, 'credentials unusable');
    return finishWith(deps, work, {
      kind: 'error',
      errorKind: 'auth',
      message: 'Stored credentials could not be read. Reconnect this account.',
    });
  }
  if (!fresh.ok) {
    return finishWith(deps, work, {
      kind: 'error',
      errorKind: fresh.error === 'needs_reauth' ? 'auth' : 'transient',
      message: fresh.message,
    });
  }

  const toItem = (i: StepWork['item']) => ({ ...i, mediaIds: [] });
  const ctx: PublishContext = {
    post: {
      id: work.postId,
      channelId: work.channel.id,
      provider: work.provider,
      settings: work.settings,
      items: work.items.map(toItem),
    },
    item: toItem(work.item),
    parent: work.parent,
    root: work.root,
    checkpoint: work.checkpoint,
    creds: fresh.creds,
    account: accountRef,
    channelCreds: null,
    target: {
      type: work.channel.targetType as TargetType,
      externalId: work.channel.externalTargetId,
    },
    media: {
      getUrl: () => Promise.reject(new Error('Media arrives in Phase 2')),
      getInfo: () => Promise.reject(new Error('Media arrives in Phase 2')),
    },
    signal: AbortSignal.timeout(deps.stepTimeoutMs ?? STEP_TIMEOUT_MS),
    now: deps.now,
  };

  let step: PublishStep;
  try {
    step = await adapter.publish(ctx);
  } catch {
    // Adapters must not throw; if one does, the request may already have gone out.
    step = { kind: 'error', errorKind: 'unknown', message: 'The adapter failed unexpectedly.' };
  }

  deps.log.info(
    { postId, position: work.item.position, provider: work.provider, mock, step: step.kind },
    'publish step finished',
  );
  return finishWith(deps, work, step);
}
