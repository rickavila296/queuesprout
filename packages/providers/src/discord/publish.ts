import type { PublishStep } from '@queuesprout/shared';
import type { PublishContext } from '../contract';
import { toStepError } from './errors';
import { discord } from './http';
import { imageSpec, SUPPRESS_EMBEDS, WEB_URL } from './limits';
import type { DiscordSettings } from './settings';
import { validateDiscord } from './validate';

interface MessageResponse {
  id: string;
  channel_id: string;
}

/**
 * One step: execute the webhook with wait=true, so Discord returns the created message.
 * Images go up in the same request (multipart, files[n] plus payload_json), with alt text
 * as each attachment's description. @everyone and @here never ping; user and role
 * mentions do.
 */
export async function publish(ctx: PublishContext<DiscordSettings>): Promise<PublishStep> {
  const blocking = validateDiscord(ctx.post).find(
    (i) =>
      i.severity === 'error' &&
      (i.itemPosition === undefined || i.itemPosition === ctx.item.position),
  );
  if (blocking) return { kind: 'error', errorKind: 'validation', message: blocking.message };

  const payload = {
    content: ctx.item.body,
    allowed_mentions: { parse: ['users', 'roles'] },
    ...(ctx.post.settings.suppressEmbeds && { flags: SUPPRESS_EMBEDS }),
  };
  let form: FormData | undefined;
  if (ctx.item.mediaIds.length > 0) {
    const spec = imageSpec(ctx.item.mediaIds.length);
    form = new FormData();
    const attachments: { id: number; filename: string; description?: string }[] = [];
    for (const [i, mediaId] of ctx.item.mediaIds.entries()) {
      const got = await ctx.media.getFile(mediaId, spec);
      if (!got.ok) {
        return {
          kind: 'error',
          errorKind: got.retryable ? 'transient' : 'validation',
          message: got.message,
        };
      }
      const filename = `image-${i + 1}.${got.file.mime.split('/')[1] ?? 'jpg'}`;
      const alt = ctx.item.altTexts?.[i];
      attachments.push({ id: i, filename, ...(alt && { description: alt }) });
      form.append(
        `files[${i}]`,
        new Blob([new Uint8Array(got.file.bytes)], { type: got.file.mime }),
        filename,
      );
    }
    form.append('payload_json', JSON.stringify({ ...payload, attachments }));
  }

  try {
    const message = await discord<MessageResponse>(
      'POST',
      `/webhooks/${ctx.account.externalId}/${ctx.creds.accessToken}?wait=true`,
      { ...(form ? { form } : { body: payload }), signal: ctx.signal, now: ctx.now },
    );
    const guild = ctx.target.externalId.split('/')[0] ?? '@me';
    return {
      kind: 'done',
      externalId: message.id,
      url: `${WEB_URL}/${guild}/${message.channel_id}/${message.id}`,
      meta: { id: message.id, channelId: message.channel_id },
    };
  } catch (error) {
    return toStepError(error);
  }
}
