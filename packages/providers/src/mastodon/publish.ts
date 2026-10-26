import type { PublishStep } from '@queuesprout/shared';
import type { PublishContext } from '../contract';
import { toStepError } from './errors';
import { mastodon } from './http';
import type { MastodonSettings } from './settings';
import { validateMastodon } from './validate';

interface StatusResponse {
  id: string;
  url?: string | null;
  uri: string;
}

/**
 * Mastodon keeps an Idempotency-Key for an hour: a retry with the same key returns the
 * status created the first time instead of posting again.
 */
export const idempotencyKey = (item: { id: string }) => `queuesprout-${item.id}`;

/**
 * One step per item: create the status, replying to the previous item for threads. The
 * spoiler text and visibility apply to every item, so a thread stays consistent.
 */
export async function publish(ctx: PublishContext<MastodonSettings>): Promise<PublishStep> {
  // Issues about other items fail their own step, not this one.
  const blocking = validateMastodon(ctx.post).find(
    (i) =>
      i.severity === 'error' &&
      (i.itemPosition === undefined || i.itemPosition === ctx.item.position),
  );
  if (blocking) return { kind: 'error', errorKind: 'validation', message: blocking.message };

  let inReplyTo: string | undefined;
  if (ctx.item.position > 0) {
    const id = ctx.parent?.meta.id;
    if (typeof id !== 'string') {
      return {
        kind: 'error',
        errorKind: 'validation',
        message: 'The previous post in this thread has no Mastodon reference.',
      };
    }
    inReplyTo = id;
  }
  if (!ctx.account.serviceUrl) {
    return {
      kind: 'error',
      errorKind: 'auth',
      message: 'This Mastodon account has no server address. Reconnect it.',
    };
  }

  const { visibility, spoilerText, language } = ctx.post.settings;
  try {
    const status = await mastodon<StatusResponse>('POST', {
      instanceUrl: ctx.account.serviceUrl,
      path: '/api/v1/statuses',
      token: ctx.creds.accessToken,
      headers: { 'idempotency-key': idempotencyKey(ctx.item) },
      body: {
        status: ctx.item.body,
        ...(inReplyTo && { in_reply_to_id: inReplyTo }),
        ...(visibility && { visibility }),
        ...(spoilerText && { spoiler_text: spoilerText, sensitive: true }),
        ...(language && { language }),
      },
      signal: ctx.signal,
      now: ctx.now,
    });
    return {
      kind: 'done',
      externalId: status.id,
      url: status.url ?? status.uri,
      meta: { id: status.id },
    };
  } catch (error) {
    return toStepError(error);
  }
}
