import type { ChannelPost, ProviderDefinition, ValidationIssue } from '../contract';
import { validateSettings, validateText } from '../validate';
import { CHARS_PER_URL, MASTODON_LIMITS, MAX_ALT_CHARS } from './limits';
import { mastodonSettingsSchema, type MastodonSettings } from './settings';

const CAPABILITIES = { threads: true, firstComment: false, asyncProcessing: false, media: true };
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const REMOTE_MENTION = /(^|[^\w@])(@[\w.-]+)@[\w.-]+\.[a-z]{2,}/gi;

/**
 * Length the way Mastodon counts it: each link is 23 characters and a remote mention
 * counts only its @username part. Spoiler text shares the same budget.
 */
export function mastodonLength(text: string, spoilerText = ''): number {
  const counted = text
    .replace(URL_PATTERN, 'x'.repeat(CHARS_PER_URL))
    .replace(REMOTE_MENTION, '$1$2');
  return [...counted].length + [...spoilerText].length;
}

export function validateMastodon(post: ChannelPost<unknown>): ValidationIssue[] {
  const issues = [
    ...validateSettings(mastodonSettingsSchema, post.settings),
    // Length is checked below with Mastodon's own counting, so links are not over-counted.
    ...validateText(post, { ...MASTODON_LIMITS, maxChars: Number.MAX_SAFE_INTEGER }, CAPABILITIES),
  ];
  const parsed = mastodonSettingsSchema.safeParse(post.settings);
  const spoiler = parsed.success ? (parsed.data.spoilerText ?? '') : '';
  for (const item of post.items) {
    // The content warning applies to every post in the thread.
    const length = mastodonLength(item.body, spoiler);
    if (length > MASTODON_LIMITS.maxChars) {
      issues.push({
        code: 'text_too_long',
        message: `Too long for Mastodon (${length} of ${MASTODON_LIMITS.maxChars} characters).`,
        severity: 'error',
        itemPosition: item.position,
        field: 'body',
      });
    }
    if ((item.altTexts ?? []).some((alt) => [...alt].length > MAX_ALT_CHARS)) {
      issues.push({
        code: 'alt_text_too_long',
        message: `Alt text can be up to ${MAX_ALT_CHARS} characters on Mastodon.`,
        severity: 'error',
        itemPosition: item.position,
        field: 'media',
      });
    }
  }
  return issues;
}

/** The browser-safe half of the adapter: limits, settings and validation. */
export const mastodonDefinition: ProviderDefinition<MastodonSettings> = {
  id: 'mastodon',
  authType: 'oauth2',
  limits: MASTODON_LIMITS,
  settingsSchema: mastodonSettingsSchema,
  capabilities: CAPABILITIES,
  validate: (post) => validateMastodon(post),
};
