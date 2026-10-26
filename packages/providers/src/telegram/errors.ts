import type { PublishStep } from '@queuesprout/shared';
import { networkErrorCode, wasNeverSent } from '../net';

/** A Bot API call that answered ok: false. */
export class TelegramError extends Error {
  constructor(
    /** Telegram's error_code, which mirrors the HTTP status. */
    public readonly status: number,
    /** Telegram's description, e.g. "Bad Request: chat not found". Never holds the token. */
    message: string,
    public readonly retryAfterMs?: number,
    /** Set when a group was upgraded to a supergroup and has a new chat id. */
    public readonly migrateToChatId?: number,
  ) {
    super(message);
    this.name = 'TelegramError';
  }
}

type StepError = Extract<PublishStep, { kind: 'error' }>;

const LOST_CHAT =
  /chat not found|bot is not a member|bot was kicked|not enough rights|need administrator rights/i;

/**
 * Maps any failure of a publish call to an errorKind. sendMessage has no idempotency key,
 * so a timeout or a dropped connection after sending is 'unknown': the message may be
 * posted, and a duplicate in someone's channel is worse than asking the user to check.
 */
export function toStepError(error: unknown): StepError {
  if (error instanceof TelegramError) {
    const raw = { status: error.status, message: error.message };
    if (error.status === 429) {
      return {
        kind: 'error',
        errorKind: 'rate_limit',
        message: 'Telegram rate limit reached.',
        ...(error.retryAfterMs !== undefined && { retryAfterMs: error.retryAfterMs }),
        raw,
      };
    }
    if (error.status === 401) {
      return {
        kind: 'error',
        errorKind: 'auth',
        message: 'The Telegram bot token was revoked. Reconnect with a new token from @BotFather.',
        raw,
      };
    }
    if (error.migrateToChatId !== undefined) {
      return {
        kind: 'error',
        errorKind: 'auth',
        message: 'This Telegram group was upgraded and has a new id. Reconnect it.',
        raw,
      };
    }
    if (error.status === 403 || LOST_CHAT.test(error.message)) {
      return {
        kind: 'error',
        errorKind: 'auth',
        message:
          'The bot can no longer post in this Telegram chat. Add it back as an admin, then reconnect.',
        raw,
      };
    }
    if (error.status === 504) {
      // A gateway timeout: Telegram may still have sent the message.
      return {
        kind: 'error',
        errorKind: 'unknown',
        message: 'Telegram timed out, so the message may or may not be posted.',
        raw,
      };
    }
    if (error.status >= 500) {
      return {
        kind: 'error',
        errorKind: 'transient',
        message: `Telegram is unavailable (${error.status}).`,
        raw,
      };
    }
    return {
      kind: 'error',
      errorKind: 'validation',
      message: `Telegram refused the message: ${error.message}`,
      raw,
    };
  }
  const name = error instanceof Error ? error.name : 'Error';
  const code = networkErrorCode(error);
  if (wasNeverSent(error)) {
    return {
      kind: 'error',
      errorKind: 'transient',
      message: 'Could not reach Telegram.',
      raw: { network: code },
    };
  }
  return {
    kind: 'error',
    errorKind: 'unknown',
    message:
      name === 'TimeoutError' || name === 'AbortError'
        ? 'Telegram did not answer in time, so the message may or may not be posted.'
        : 'The connection to Telegram dropped, so the message may or may not be posted.',
    raw: { network: code ?? name },
  };
}
