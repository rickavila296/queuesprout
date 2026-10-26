import type { ChannelPost, ProviderDefinition, ValidationIssue } from '../contract';
import { validateSettings, validateText } from '../validate';
import { DISCORD_LIMITS } from './limits';
import { discordSettingsSchema, type DiscordSettings } from './settings';

const CAPABILITIES = { threads: false, firstComment: false, asyncProcessing: false };

export function validateDiscord(post: ChannelPost<unknown>): ValidationIssue[] {
  return [
    ...validateSettings(discordSettingsSchema, post.settings),
    ...validateText(post, DISCORD_LIMITS, CAPABILITIES),
  ];
}

/** The browser-safe half of the adapter: limits, settings and validation. */
export const discordDefinition: ProviderDefinition<DiscordSettings> = {
  id: 'discord',
  authType: 'bot_token',
  limits: DISCORD_LIMITS,
  settingsSchema: discordSettingsSchema,
  capabilities: CAPABILITIES,
  validate: (post) => validateDiscord(post),
};
