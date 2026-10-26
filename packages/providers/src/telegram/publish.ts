import type { PublishStep } from '@queuesprout/shared';
import type { PublishContext } from '../contract';
import { toStepError } from './errors';
import { telegram } from './http';
import { WEB_URL } from './limits';
import type { TelegramSettings } from './settings';
import { validateTelegram } from './validate';

interface MessageResponse {
  message_id: number;
  chat: { id: number; username?: string };
}

/**
 * A link to the message: t.me/<name>/<id> for public chats, t.me/c/<id>/<id> for private
 * channels and supergroups. Basic groups have no message links, so the URL is empty.
 */
export function messageUrl(message: MessageResponse): string {
  const { chat, message_id: id } = message;
  if (chat.username) return `${WEB_URL}/${chat.username}/${id}`;
  const chatId = String(chat.id);
  return chatId.startsWith('-100') ? `${WEB_URL}/c/${chatId.slice(4)}/${id}` : '';
}

/** One step: sendMessage as plain text, so nothing in the post is read as markup. */
export async function publish(ctx: PublishContext<TelegramSettings>): Promise<PublishStep> {
  const blocking = validateTelegram(ctx.post).find(
    (i) =>
      i.severity === 'error' &&
      (i.itemPosition === undefined || i.itemPosition === ctx.item.position),
  );
  if (blocking) return { kind: 'error', errorKind: 'validation', message: blocking.message };

  const { disableLinkPreview, silent } = ctx.post.settings;
  try {
    const message = await telegram<MessageResponse>(ctx.creds.accessToken, 'sendMessage', {
      body: {
        chat_id: ctx.target.externalId,
        text: ctx.item.body,
        ...(disableLinkPreview && { link_preview_options: { is_disabled: true } }),
        ...(silent && { disable_notification: true }),
      },
      signal: ctx.signal,
      now: ctx.now,
    });
    return {
      kind: 'done',
      externalId: String(message.message_id),
      url: messageUrl(message),
      meta: { messageId: message.message_id, chatId: message.chat.id },
    };
  } catch (error) {
    return toStepError(error);
  }
}
