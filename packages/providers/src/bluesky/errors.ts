import type { PublishStep } from '@queuesprout/shared';

/** An XRPC call that returned a non-2xx status. */
export class XrpcError extends Error {
  constructor(
    public readonly status: number,
    /** The lexicon error name, e.g. "ExpiredToken", "RateLimitExceeded". */
    public readonly error: string | undefined,
    message: string,
    /** From Retry-After or ratelimit-reset, when the server sent one. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'XrpcError';
  }
}

/** Errors that mean the login itself is gone: only reconnecting fixes them. */
export const GRANT_GONE = new Set([
  'InvalidToken',
  'AuthenticationRequired',
  'AccountTakedown',
  'AccountDeactivated',
  'AccountSuspended',
]);

type StepError = Extract<PublishStep, { kind: 'error' }>;

/**
 * Maps any failure of a publish call to an errorKind. Posts are written with a fixed
 * record key, so retrying after a timeout cannot double-post: network failures and
 * timeouts are transient, not unknown.
 */
export function toStepError(error: unknown): StepError {
  if (error instanceof XrpcError) {
    const raw = { status: error.status, error: error.error ?? null, message: error.message };
    if (error.status === 429) {
      return {
        kind: 'error',
        errorKind: 'rate_limit',
        message: 'Bluesky rate limit reached.',
        ...(error.retryAfterMs !== undefined && { retryAfterMs: error.retryAfterMs }),
        raw,
      };
    }
    if (error.error === 'ExpiredToken') {
      // The token died early; the next step refreshes it under the row lock.
      return { kind: 'error', errorKind: 'transient', message: 'Bluesky session expired.', raw };
    }
    if (error.status === 401 || (error.error && GRANT_GONE.has(error.error))) {
      return {
        kind: 'error',
        errorKind: 'auth',
        message: 'Bluesky rejected the login. Reconnect the account with a new app password.',
        raw,
      };
    }
    if (error.status >= 500) {
      return {
        kind: 'error',
        errorKind: 'transient',
        message: `Bluesky is unavailable (${error.status}).`,
        raw,
      };
    }
    return {
      kind: 'error',
      errorKind: 'validation',
      message: `Bluesky refused the post: ${error.message}`,
      raw,
    };
  }
  const name = error instanceof Error ? error.name : 'Error';
  return {
    kind: 'error',
    errorKind: 'transient',
    message:
      name === 'TimeoutError' || name === 'AbortError'
        ? 'Bluesky did not answer in time.'
        : 'Could not reach Bluesky.',
    raw: { network: name },
  };
}
