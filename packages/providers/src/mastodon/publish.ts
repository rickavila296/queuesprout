import type { PublishCheckpoint, PublishStep } from '@queuesprout/shared';
import type { PublishContext } from '../contract';
import { toStepError } from './errors';
import { mastodon } from './http';
import { IMAGE_SPEC, MEDIA_POLL_MS } from './limits';
import type { MastodonSettings } from './settings';
import { validateMastodon } from './validate';

interface StatusResponse {
  id: string;
  url?: string | null;
  uri: string;
}

interface MediaAttachment {
  id: string;
  /** Null while the server is still processing the upload. */
  url: string | null;
}

/** Checkpoint stage once an item's images are uploaded; childContainerIds holds their ids. */
const MEDIA_UPLOADED = 'media_uploaded';

type StepError = Extract<PublishStep, { kind: 'error' }>;
type Call = { instanceUrl: string; token: string; signal: AbortSignal; now: () => Date };

/** Uploads the item's images with their alt text. Ids in order, plus whether all are ready. */
async function uploadMedia(
  ctx: PublishContext<MastodonSettings>,
  call: Call,
): Promise<{ ids: string[]; ready: boolean } | { error: StepError }> {
  const ids: string[] = [];
  let ready = true;
  for (const [i, mediaId] of ctx.item.mediaIds.entries()) {
    const got = await ctx.media.getFile(mediaId, IMAGE_SPEC);
    if (!got.ok) {
      return {
        error: {
          kind: 'error',
          errorKind: got.retryable ? 'transient' : 'validation',
          message: got.message,
        },
      };
    }
    const form = new FormData();
    const ext = got.file.mime.split('/')[1] ?? 'jpg';
    form.append(
      'file',
      new Blob([new Uint8Array(got.file.bytes)], { type: got.file.mime }),
      `image-${i + 1}.${ext}`,
    );
    const alt = ctx.item.altTexts?.[i];
    if (alt) form.append('description', alt);
    const uploaded = await mastodon<MediaAttachment>('POST', {
      ...call,
      path: '/api/v2/media',
      form,
    });
    ids.push(uploaded.id);
    ready &&= uploaded.url !== null;
  }
  return { ids, ready };
}

/** True once the server has processed every upload (a processing one has no url yet). */
async function allProcessed(call: Call, ids: string[]): Promise<boolean> {
  for (const id of ids) {
    const media = await mastodon<MediaAttachment>('GET', {
      ...call,
      path: `/api/v1/media/${encodeURIComponent(id)}`,
    });
    if (media.url === null) return false;
  }
  return true;
}

/**
 * Mastodon keeps an Idempotency-Key for an hour: a retry with the same key returns the
 * status created the first time instead of posting again.
 */
export const idempotencyKey = (item: { id: string }) => `queuesprout-${item.id}`;

/**
 * Per item: upload its images, and while the server is still processing any of them,
 * return pending with their ids in the checkpoint; later steps only check on those ids,
 * never upload again. Once all are ready (often at once), create the status, replying to
 * the previous item for threads. The spoiler text and visibility apply to every item, so a
 * thread stays consistent.
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

  const call: Call = {
    instanceUrl: ctx.account.serviceUrl,
    token: ctx.creds.accessToken,
    signal: ctx.signal,
    now: ctx.now,
  };
  const { visibility, spoilerText, language } = ctx.post.settings;
  try {
    let mediaIds: string[] = [];
    if (ctx.checkpoint?.stage === MEDIA_UPLOADED) {
      mediaIds = ctx.checkpoint.childContainerIds ?? [];
      if (!(await allProcessed(call, mediaIds))) {
        return { kind: 'pending', checkpoint: ctx.checkpoint, pollAfterMs: MEDIA_POLL_MS };
      }
    } else if (ctx.item.mediaIds.length > 0) {
      const uploaded = await uploadMedia(ctx, call);
      if ('error' in uploaded) return uploaded.error;
      mediaIds = uploaded.ids;
      if (!uploaded.ready) {
        const checkpoint: PublishCheckpoint = {
          stage: MEDIA_UPLOADED,
          childContainerIds: mediaIds,
          startedAt: ctx.now().toISOString(),
        };
        return { kind: 'pending', checkpoint, pollAfterMs: MEDIA_POLL_MS };
      }
    }

    const status = await mastodon<StatusResponse>('POST', {
      ...call,
      path: '/api/v1/statuses',
      headers: { 'idempotency-key': idempotencyKey(ctx.item) },
      body: {
        status: ctx.item.body,
        ...(mediaIds.length > 0 && { media_ids: mediaIds }),
        ...(inReplyTo && { in_reply_to_id: inReplyTo }),
        ...(visibility && { visibility }),
        ...(spoilerText && { spoiler_text: spoilerText, sensitive: true }),
        ...(language && { language }),
      },
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
