import type { ChannelPost, ProviderDefinition, ValidationIssue } from '../contract';
import { validateSettings, validateText } from '../validate';
import { SLACK_LIMITS } from './limits';
import { slackSettingsSchema, type SlackSettings } from './settings';

const CAPABILITIES = { threads: true, firstComment: false, asyncProcessing: false };

export function validateSlack(post: ChannelPost<unknown>): ValidationIssue[] {
  return [
    ...validateSettings(slackSettingsSchema, post.settings),
    ...validateText(post, SLACK_LIMITS, CAPABILITIES),
  ];
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
