import type {
  AccountCredentials,
  ProviderId,
  PublishErrorKind,
  PublishStep,
} from '@queuesprout/shared';
import type {
  ConnectedAccountInput,
  ProviderAdapter,
  ProviderDefinition,
  PublishContext,
  Target,
} from '../contract';
import { hasErrors } from '../validate';
import { ulid } from './ulid';

/**
 * Sandbox mode (ADR-019). Wraps a provider's definition, runs its real validate()
 * and settings schema, then pretends to publish: no platform is ever called. The
 * worker picks this adapter whenever PUBLISH_MODE=mock or the workspace is a sandbox.
 */

/** Text markers that make the mock fail. Only the mock reads them, so only mock mode honours them. */
export const MOCK_FAILURES = {
  '[[mock:rate_limit]]': 'rate_limit',
  '[[mock:auth]]': 'auth',
  '[[mock:transient]]': 'transient',
  '[[mock:timeout]]': 'timeout',
} as const;

export const MOCK_STAGES = { containerCreated: 'container_created' } as const;

export interface MockOptions {
  /** PUBLIC_URL of the web app; result URLs point at its /mock/posts/<id> preview page. */
  publicUrl: string;
  /** Simulated latency per step, in ms. Default 300 to 1,500. */
  latencyMs?: { min: number; max: number };
  /** Delay before the next status check of an async provider. Default 1,000. */
  pollAfterMs?: number;
  random?: () => number;
  /** Waits ms or rejects when the signal aborts. Injected so tests run instantly. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const RATE_LIMIT_RETRY_MS = 60_000;

function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function findMockFailure(
  text: string,
): (typeof MOCK_FAILURES)[keyof typeof MOCK_FAILURES] | null {
  for (const [marker, kind] of Object.entries(MOCK_FAILURES)) {
    if (text.includes(marker)) return kind;
  }
  return null;
}

function failure(kind: ReturnType<typeof findMockFailure> & string): PublishStep {
  const errors: Record<typeof kind, { errorKind: PublishErrorKind; message: string }> = {
    rate_limit: { errorKind: 'rate_limit', message: 'Mock rate limit (429).' },
    auth: { errorKind: 'auth', message: 'Mock auth failure (401): reconnect the account.' },
    transient: { errorKind: 'transient', message: 'Mock platform error (503).' },
    // The request may have reached the platform, so the worker must not retry blindly.
    timeout: { errorKind: 'unknown', message: 'Mock timeout after sending: verify on platform.' },
  };
  const e = errors[kind];
  return {
    kind: 'error',
    errorKind: e.errorKind,
    message: e.message,
    ...(kind === 'rate_limit' && { retryAfterMs: RATE_LIMIT_RETRY_MS }),
    raw: { mock: true, failure: kind },
  };
}

export const mockExternalId = (provider: ProviderId, random: () => number = Math.random) =>
  `mock_${provider}_${ulid(Date.now(), random)}`;

/** A fake account for "Connect demo channel": no OAuth, no platform call. */
export function demoAccount(
  provider: ProviderId,
  random: () => number = Math.random,
): ConnectedAccountInput {
  const id = mockExternalId(provider, random);
  const name = `Demo ${provider.charAt(0).toUpperCase()}${provider.slice(1)}`;
  return {
    externalAccountId: id,
    displayName: name,
    creds: {
      accessToken: `mock-access-${ulid(Date.now(), random)}`,
      refreshToken: `mock-refresh-${ulid(Date.now(), random)}`,
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: ['mock'],
    },
    targets: [demoTarget(provider, id, name)],
  };
}

function demoTarget(provider: ProviderId, externalId: string, name: string): Target {
  return {
    targetType: provider === 'pinterest' ? 'account' : 'profile',
    externalTargetId: externalId,
    name,
    handle: `@demo.${provider}`,
    ...(provider === 'pinterest' && { defaultSettings: { board_id: 'mock_board' } }),
  };
}

export function createMockAdapter<TSettings>(
  base: ProviderDefinition<TSettings>,
  options: MockOptions,
): ProviderAdapter<TSettings> {
  const random = options.random ?? Math.random;
  const wait = options.wait ?? abortableWait;
  const latency = options.latencyMs ?? { min: 300, max: 1500 };
  const pollAfterMs = options.pollAfterMs ?? 1000;
  const publicUrl = options.publicUrl.replace(/\/+$/, '');

  const refresh = async (_creds: AccountCredentials): Promise<AccountCredentials> => ({
    accessToken: `mock-access-${ulid(Date.now(), random)}`,
    refreshToken: `mock-refresh-${ulid(Date.now(), random)}`,
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: ['mock'],
  });

  return {
    ...base,

    async connectWithSecret() {
      return demoAccount(base.id, random);
    },
    async getAuthUrl(ctx) {
      return { url: `${publicUrl}/mock/oauth?state=${encodeURIComponent(ctx.state)}` };
    },
    async exchangeCode() {
      return demoAccount(base.id, random);
    },
    refreshToken: refresh,
    async listTargets() {
      return [demoTarget(base.id, mockExternalId(base.id, random), `Demo ${base.id}`)];
    },

    async publish(ctx: PublishContext<TSettings>): Promise<PublishStep> {
      const issues = base.validate(ctx.post, []);
      if (hasErrors(issues)) {
        const first = issues.find((i) => i.severity === 'error');
        return {
          kind: 'error',
          errorKind: 'validation',
          message: first?.message ?? 'Invalid post.',
          raw: { issues },
        };
      }

      const marker = findMockFailure(ctx.item.body);
      if (marker) return failure(marker);

      try {
        await wait(
          latency.min + Math.floor(random() * (latency.max - latency.min + 1)),
          ctx.signal,
        );
      } catch {
        return { kind: 'error', errorKind: 'transient', message: 'Step deadline reached.' };
      }

      if (base.capabilities.asyncProcessing) {
        const checkpoint = ctx.checkpoint;
        if (!checkpoint) {
          // Step 1: create the container and say how many status checks it will take (1 or 2).
          return {
            kind: 'pending',
            checkpoint: {
              stage: MOCK_STAGES.containerCreated,
              containerId: `mock_container_${ulid(ctx.now().getTime(), random)}`,
              startedAt: ctx.now().toISOString(),
              data: { checksLeft: random() < 0.5 ? 1 : 2 },
            },
            pollAfterMs,
          };
        }
        // Later steps reuse the container in the checkpoint, never a new one.
        const checksLeft = Number(checkpoint.data?.checksLeft ?? 0);
        if (checksLeft > 1) {
          return {
            kind: 'pending',
            checkpoint: { ...checkpoint, data: { ...checkpoint.data, checksLeft: checksLeft - 1 } },
            pollAfterMs,
          };
        }
      }

      const externalId = mockExternalId(base.id, random);
      return {
        kind: 'done',
        externalId,
        url: `${publicUrl}/mock/posts/${externalId}`,
        meta: {
          mock: true,
          ...(ctx.checkpoint?.containerId && { containerId: ctx.checkpoint.containerId }),
          ...(ctx.parent && { replyTo: ctx.parent.externalId }),
          ...(ctx.root && { root: ctx.root.externalId }),
        },
      };
    },
  };
}
