import type { ChannelPost, ProviderDefinition, ValidationIssue } from '../contract';
import { validateSettings, validateText } from '../validate';
import { TELEGRAM_LIMITS } from './limits';
import { telegramSettingsSchema, type TelegramSettings } from './settings';

const CAPABILITIES = { threads: false, firstComment: false, asyncProcessing: false };

export function validateTelegram(post: ChannelPost<unknown>): ValidationIssue[] {
  return [
    ...validateSettings(telegramSettingsSchema, post.settings),
    ...validateText(post, TELEGRAM_LIMITS, CAPABILITIES),
  ];
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
