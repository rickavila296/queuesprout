import { countChars } from '@queuesprout/shared';
import type { ChannelPost, ProviderDefinition, ValidationIssue } from '../contract';
import { validateSettings, validateText } from '../validate';
import { BLUESKY_LIMITS, MAX_ALT_GRAPHEMES, MAX_TEXT_BYTES } from './limits';
import { blueskySettingsSchema, type BlueskySettings } from './settings';

const CAPABILITIES = { threads: true, firstComment: false, asyncProcessing: false, media: true };
const encoder = new TextEncoder();

/** Shared checks plus Bluesky's byte limit (a post can hit it before 300 graphemes with emoji). */
export function validateBluesky(post: ChannelPost<unknown>): ValidationIssue[] {
  const issues = [
    ...validateSettings(blueskySettingsSchema, post.settings),
    ...validateText(post, BLUESKY_LIMITS, CAPABILITIES),
  ];
  for (const item of post.items) {
    const bytes = encoder.encode(item.body).length;
    if (bytes > MAX_TEXT_BYTES) {
      issues.push({
        code: 'text_too_many_bytes',
        message: `Too long for Bluesky (${bytes} of ${MAX_TEXT_BYTES} bytes).`,
        severity: 'error',
        itemPosition: item.position,
        field: 'body',
      });
    }
    for (const alt of item.altTexts ?? []) {
      if (countChars(alt, 'graphemes') > MAX_ALT_GRAPHEMES) {
        issues.push({
          code: 'alt_text_too_long',
          message: `Alt text can be up to ${MAX_ALT_GRAPHEMES} characters on Bluesky.`,
          severity: 'error',
          itemPosition: item.position,
          field: 'media',
        });
      }
    }
  }
  return issues;
}

/** The browser-safe half of the adapter: limits, settings and validation. */
export const blueskyDefinition: ProviderDefinition<BlueskySettings> = {
  id: 'bluesky',
  authType: 'app_password',
  limits: BLUESKY_LIMITS,
  settingsSchema: blueskySettingsSchema,
  capabilities: CAPABILITIES,
  validate: (post) => validateBluesky(post),
};
