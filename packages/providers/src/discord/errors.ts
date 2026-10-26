import type { PublishStep } from '@queuesprout/shared';
import { networkErrorCode, wasNeverSent } from '../net';

/** A Discord API call that returned a non-2xx status. */
export class DiscordError extends Error {
  constructor(
    public readonly status: number,
    /** Discord's JSON error code, e.g. 10015 Unknown Webhook. */
    public readonly code: number | undefined,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'DiscordError';
  }
}

/** The webhook was deleted or its token reset: only reconnecting fixes it. */
export const UNKNOWN_WEBHOOK = 10015;

type StepError = Extract<PublishStep, { kind: 'error' }>;

/**
 * Maps any failure of a publish call to an errorKind. Webhooks have no idempotency key,
 * so a timeout or a dropped connection after sending is 'unknown': the message may be
 * posted, and a duplicate in someone's server is worse than asking the user to check.
 */
export function toStepError(error: unknown): StepError {
  if (error instanceof DiscordError) {
    const raw = { status: error.status, code: error.code ?? null, message: error.message };
    if (error.status === 429) {
      return {
        kind: 'error',
        errorKind: 'rate_limit',
        message: 'Discord rate limit reached.',
        ...(error.retryAfterMs !== undefined && { retryAfterMs: error.retryAfterMs }),
        raw,
      };
    }
    if (error.status === 401 || error.status === 403 || error.code === UNKNOWN_WEBHOOK) {
      return {
        kind: 'error',
        errorKind: 'auth',
        message: 'The Discord webhook was deleted or reset. Reconnect the channel with a new one.',
        raw,
      };
    }
    if (error.status === 504) {
      // A gateway timeout: Discord itself may still have created the message.
      return {
        kind: 'error',
        errorKind: 'unknown',
        message: 'Discord timed out, so the message may or may not be posted.',
        raw,
      };
    }
    if (error.status >= 500) {
      // Discord answered with an error, so the message was not created.
      return {
        kind: 'error',
        errorKind: 'transient',
        message: `Discord is unavailable (${error.status}).`,
        raw,
      };
    }
    return {
      kind: 'error',
      errorKind: 'validation',
      message: `Discord refused the message: ${error.message}`,
      raw,
    };
  }
  const name = error instanceof Error ? error.name : 'Error';
  const code = networkErrorCode(error);
  if (wasNeverSent(error)) {
    return {
      kind: 'error',
      errorKind: 'transient',
      message: 'Could not reach Discord.',
      raw: { network: code },
    };
  }
  return {
    kind: 'error',
    errorKind: 'unknown',
    message:
      name === 'TimeoutError' || name === 'AbortError'
        ? 'Discord did not answer in time, so the message may or may not be posted.'
        : 'The connection to Discord dropped, so the message may or may not be posted.',
    raw: { network: code ?? name },
  };
}
