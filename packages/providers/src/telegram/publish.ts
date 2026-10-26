import type { PublishStep } from '@queuesprout/shared';
import type { PublishContext } from '../contract';
import { toStepError } from './errors';
import { telegram } from './http';
import { IMAGE_SPEC, WEB_URL } from './limits';
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

type StepError = Extract<PublishStep, { kind: 'error' }>;

/**
 * The photo upload for the item: sendPhoto for one image, sendMediaGroup (an album) for
 * more, with the text as the caption of the first photo.
 */
async function photoForm(
  ctx: PublishContext<TelegramSettings>,
): Promise<{ method: string; form: FormData } | { error: StepError }> {
  const form = new FormData();
  const { silent } = ctx.post.settings;
  form.append('chat_id', ctx.target.externalId);
  if (silent) form.append('disable_notification', 'true');
  // sendPhoto takes its file in the "photo" field; an album refers to each by attach://name.
  const single = ctx.item.mediaIds.length === 1;
  const names: string[] = [];
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
    const name = single ? 'photo' : `photo${i}`;
    names.push(name);
    form.append(
      name,
      new Blob([new Uint8Array(got.file.bytes)], { type: got.file.mime }),
      `${name}.${got.file.mime.split('/')[1] ?? 'jpg'}`,
    );
  }
  const caption = ctx.item.body.trim() === '' ? undefined : ctx.item.body;
  if (single) {
    if (caption) form.append('caption', caption);
    return { method: 'sendPhoto', form };
  }
  form.append(
    'media',
    JSON.stringify(
      names.map((name, i) => ({
        type: 'photo',
        media: `attach://${name}`,
        ...(i === 0 && caption && { caption }),
      })),
    ),
  );
  return { method: 'sendMediaGroup', form };
}

/**
 * One step: sendMessage, or the photos with the text as their caption. Text is sent
 * plain, so nothing in the post is read as markup.
 */
export async function publish(ctx: PublishContext<TelegramSettings>): Promise<PublishStep> {
  const blocking = validateTelegram(ctx.post).find(
    (i) =>
      i.severity === 'error' &&
      (i.itemPosition === undefined || i.itemPosition === ctx.item.position),
  );
  if (blocking) return { kind: 'error', errorKind: 'validation', message: blocking.message };

  const { disableLinkPreview, silent } = ctx.post.settings;
  try {
    if (ctx.item.mediaIds.length > 0) {
      const upload = await photoForm(ctx);
      if ('error' in upload) return upload.error;
      const sent = await telegram<MessageResponse | MessageResponse[]>(
        ctx.creds.accessToken,
        upload.method,
        { form: upload.form, signal: ctx.signal, now: ctx.now },
      );
      // An album answers with one message per photo; the first one carries the caption.
      const message = Array.isArray(sent) ? sent[0] : sent;
      if (!message) {
        return { kind: 'error', errorKind: 'unknown', message: 'Telegram returned no message.' };
      }
      return done(message);
    }
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
    return done(message);
  } catch (error) {
    return toStepError(error);
  }
}

function done(message: MessageResponse): PublishStep {
  return {
    kind: 'done',
    externalId: String(message.message_id),
    url: messageUrl(message),
    meta: { messageId: message.message_id, chatId: message.chat.id },
  };
}
