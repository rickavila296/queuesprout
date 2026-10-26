import type { PublishStep } from '@queuesprout/shared';

/** A Mastodon API call that returned a non-2xx status. */
export class MastodonError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** From Retry-After or X-RateLimit-Reset, when the server sent one. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'MastodonError';
  }
}

type StepError = Extract<PublishStep, { kind: 'error' }>;

/**
 * Maps any failure of a publish call to an errorKind. Statuses are created with an
 * Idempotency-Key, so a retry after a timeout returns the first post instead of a
 * second one: network failures and timeouts are transient.
 */
export function toStepError(error: unknown): StepError {
  if (error instanceof MastodonError) {
    const raw = { status: error.status, message: error.message };
    if (error.status === 429) {
      return {
        kind: 'error',
        errorKind: 'rate_limit',
        message: 'Mastodon rate limit reached.',
        ...(error.retryAfterMs !== undefined && { retryAfterMs: error.retryAfterMs }),
        raw,
      };
    }
    if (error.status === 401) {
      return {
        kind: 'error',
        errorKind: 'auth',
        message: 'Mastodon rejected the login. Reconnect the account.',
        raw,
      };
    }
    if (error.status === 403) {
      // Suspended or limited account, or a token without write:statuses.
      return {
        kind: 'error',
        errorKind: 'auth',
        message: `Mastodon refused this account: ${error.message}`,
        raw,
      };
    }
    if (error.status >= 500) {
      return {
        kind: 'error',
        errorKind: 'transient',
        message: `The Mastodon server is unavailable (${error.status}).`,
        raw,
      };
    }
    // 404 (the post replied to is gone), 422 (too long, bad language), 400.
    return {
      kind: 'error',
      errorKind: 'validation',
      message: `Mastodon refused the post: ${error.message}`,
      raw,
    };
  }
  const name = error instanceof Error ? error.name : 'Error';
  return {
    kind: 'error',
    errorKind: 'transient',
    message:
      name === 'TimeoutError' || name === 'AbortError'
        ? 'The Mastodon server did not answer in time.'
        : 'Could not reach the Mastodon server.',
    raw: { network: name },
  };
}
