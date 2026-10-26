import type { ChannelPost, ProviderDefinition, ValidationIssue } from '../contract';
import { validateSettings, validateText } from '../validate';
import { DISCORD_LIMITS, MAX_ALT_CHARS } from './limits';
import { discordSettingsSchema, type DiscordSettings } from './settings';

const CAPABILITIES = { threads: false, firstComment: false, asyncProcessing: false, media: true };

export function validateDiscord(post: ChannelPost<unknown>): ValidationIssue[] {
  const issues = [
    ...validateSettings(discordSettingsSchema, post.settings),
    ...validateText(post, DISCORD_LIMITS, CAPABILITIES),
  ];
  for (const item of post.items) {
    if ((item.altTexts ?? []).some((alt) => [...alt].length > MAX_ALT_CHARS)) {
      issues.push({
        code: 'alt_text_too_long',
        message: `Alt text can be up to ${MAX_ALT_CHARS} characters on Discord.`,
        severity: 'error',
        itemPosition: item.position,
        field: 'media',
      });
    }
  }
  return issues;
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
