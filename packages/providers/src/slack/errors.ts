import type { PublishStep } from '@queuesprout/shared';
import { networkErrorCode, wasNeverSent } from '../net';

/**
 * A Web API call that failed. Slack answers most errors with HTTP 200 and ok: false, so
 * `code` (e.g. "channel_not_found") matters more than `status`.
 */
export class SlackError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'SlackError';
  }
}

/** The token or the bot's place in the channel is gone: only reconnecting fixes it. */
const AUTH = new Set([
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
  'no_permission',
  'missing_scope',
  'ekm_access_denied',
  'team_access_not_granted',
  'org_login_required',
  'channel_not_found',
  'not_in_channel',
  'is_archived',
]);

/** Slack failed before creating the message. */
const TRANSIENT = new Set([
  'internal_error',
  'fatal_error',
  'service_unavailable',
  'request_timeout',
  'team_added_to_org',
]);

type StepError = Extract<PublishStep, { kind: 'error' }>;

/**
 * Maps any failure of a publish call to an errorKind. chat.postMessage has no idempotency
 * key, so a timeout or a dropped connection after sending is 'unknown': the message may be
 * posted, and a duplicate in someone's workspace is worse than asking the user to check.
 */
export function toStepError(error: unknown): StepError {
  if (error instanceof SlackError) {
    const raw = { status: error.status, code: error.code };
    if (error.status === 429 || error.code === 'ratelimited') {
      return {
        kind: 'error',
        errorKind: 'rate_limit',
        message: 'Slack rate limit reached.',
        ...(error.retryAfterMs !== undefined && { retryAfterMs: error.retryAfterMs }),
        raw,
      };
    }
    if (error.code === 'missing_scope') {
      return {
        kind: 'error',
        errorKind: 'auth',
        message:
          'The Slack app is missing a scope (images need files:write). Add it, reinstall the app and reconnect with the new token.',
        raw,
      };
    }
    if (AUTH.has(error.code)) {
      const inChannel = ['channel_not_found', 'not_in_channel', 'is_archived'].includes(error.code);
      return {
        kind: 'error',
        errorKind: 'auth',
        message: inChannel
          ? 'The Slack app can no longer post in this channel. Invite it back with /invite, then reconnect.'
          : 'The Slack app was removed or its token revoked. Reconnect it with a new bot token.',
        raw,
      };
    }
    if (error.status === 504) {
      // A gateway timeout: Slack may still have posted the message.
      return {
        kind: 'error',
        errorKind: 'unknown',
        message: 'Slack timed out, so the message may or may not be posted.',
        raw,
      };
    }
    if (error.status >= 500 || TRANSIENT.has(error.code)) {
      return {
        kind: 'error',
        errorKind: 'transient',
        message: `Slack is unavailable (${error.code}).`,
        raw,
      };
    }
    return {
      kind: 'error',
      errorKind: 'validation',
      message: `Slack refused the message: ${error.code}`,
      raw,
    };
  }
  const name = error instanceof Error ? error.name : 'Error';
  const code = networkErrorCode(error);
  if (wasNeverSent(error)) {
    return {
      kind: 'error',
      errorKind: 'transient',
      message: 'Could not reach Slack.',
      raw: { network: code },
    };
  }
  return {
    kind: 'error',
    errorKind: 'unknown',
    message:
      name === 'TimeoutError' || name === 'AbortError'
        ? 'Slack did not answer in time, so the message may or may not be posted.'
        : 'The connection to Slack dropped, so the message may or may not be posted.',
    raw: { network: code ?? name },
  };
}
