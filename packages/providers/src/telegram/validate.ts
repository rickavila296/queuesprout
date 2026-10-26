import type { ChannelPost, ProviderDefinition, ValidationIssue } from '../contract';
import { validateSettings, validateText } from '../validate';
import { MAX_CAPTION_CHARS, TELEGRAM_LIMITS } from './limits';
import { telegramSettingsSchema, type TelegramSettings } from './settings';

const CAPABILITIES = { threads: false, firstComment: false, asyncProcessing: false, media: true };

export function validateTelegram(post: ChannelPost<unknown>): ValidationIssue[] {
  const issues = [
    ...validateSettings(telegramSettingsSchema, post.settings),
    ...validateText(post, TELEGRAM_LIMITS, CAPABILITIES),
  ];
  for (const item of post.items) {
    if (item.mediaIds.length === 0) continue;
    const length = [...item.body].length;
    if (length > MAX_CAPTION_CHARS) {
      issues.push({
        code: 'caption_too_long',
        message: `With images, Telegram allows ${MAX_CAPTION_CHARS} characters (${length} now).`,
        severity: 'error',
        itemPosition: item.position,
        field: 'body',
      });
    }
    if ((item.altTexts ?? []).some((alt) => alt.trim() !== '')) {
      issues.push({
        code: 'alt_text_unsupported',
        message: 'Telegram does not show alt text, so it will not be sent.',
        severity: 'warning',
        itemPosition: item.position,
        field: 'media',
      });
    }
  }
  return issues;
}

/** The browser-safe half of the adapter: limits, settings and validation. */
export const telegramDefinition: ProviderDefinition<TelegramSettings> = {
  id: 'telegram',
  authType: 'bot_token',
  limits: TELEGRAM_LIMITS,
  settingsSchema: telegramSettingsSchema,
  capabilities: CAPABILITIES,
  validate: (post) => validateTelegram(post),
};
