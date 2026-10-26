import type { ChannelPost, ProviderDefinition, ValidationIssue } from '../contract';
import { validateSettings, validateText } from '../validate';
import { MAX_ALT_CHARS, SLACK_LIMITS } from './limits';
import { slackSettingsSchema, type SlackSettings } from './settings';

const CAPABILITIES = { threads: true, firstComment: false, asyncProcessing: false, media: true };

export function validateSlack(post: ChannelPost<unknown>): ValidationIssue[] {
  const issues = [
    ...validateSettings(slackSettingsSchema, post.settings),
    ...validateText(post, SLACK_LIMITS, CAPABILITIES),
  ];
  for (const item of post.items) {
    if ((item.altTexts ?? []).some((alt) => [...alt].length > MAX_ALT_CHARS)) {
      issues.push({
        code: 'alt_text_too_long',
        message: `Alt text can be up to ${MAX_ALT_CHARS} characters on Slack.`,
        severity: 'error',
        itemPosition: item.position,
        field: 'media',
      });
    }
  }
  return issues;
}

/** The browser-safe half of the adapter: limits, settings and validation. */
export const slackDefinition: ProviderDefinition<SlackSettings> = {
  id: 'slack',
  authType: 'bot_token',
  limits: SLACK_LIMITS,
  settingsSchema: slackSettingsSchema,
  capabilities: CAPABILITIES,
  validate: (post) => validateSlack(post),
};
