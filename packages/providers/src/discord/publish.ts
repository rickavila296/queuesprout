import type { PublishStep } from '@queuesprout/shared';
import type { PublishContext } from '../contract';
import { toStepError } from './errors';
import { discord } from './http';
import { SUPPRESS_EMBEDS, WEB_URL } from './limits';
import type { DiscordSettings } from './settings';
import { validateDiscord } from './validate';

interface MessageResponse {
  id: string;
  channel_id: string;
}

/**
 * One step: execute the webhook with wait=true, so Discord returns the created message.
 * @everyone and @here never ping; user and role mentions do.
 */
export async function publish(ctx: PublishContext<DiscordSettings>): Promise<PublishStep> {
  const blocking = validateDiscord(ctx.post).find(
    (i) =>
      i.severity === 'error' &&
      (i.itemPosition === undefined || i.itemPosition === ctx.item.position),
  );
  if (blocking) return { kind: 'error', errorKind: 'validation', message: blocking.message };

  try {
    const message = await discord<MessageResponse>(
      'POST',
      `/webhooks/${ctx.account.externalId}/${ctx.creds.accessToken}?wait=true`,
      {
        body: {
          content: ctx.item.body,
          allowed_mentions: { parse: ['users', 'roles'] },
          ...(ctx.post.settings.suppressEmbeds && { flags: SUPPRESS_EMBEDS }),
        },
        signal: ctx.signal,
        now: ctx.now,
      },
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
