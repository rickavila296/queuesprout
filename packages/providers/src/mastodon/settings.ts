import { z } from 'zod';
import { MAX_SPOILER_CHARS } from './limits';

export const MASTODON_VISIBILITIES = ['public', 'unlisted', 'private'] as const;

/**
 * Per-post Mastodon options. visibility: who sees it (direct messages are out of scope);
 * spoilerText: a content warning shown before the text; language: ISO 639 code.
 */
export const mastodonSettingsSchema = z.object({
  visibility: z.enum(MASTODON_VISIBILITIES).optional(),
  spoilerText: z
    .string()
    .trim()
    .max(MAX_SPOILER_CHARS, `Content warnings are at most ${MAX_SPOILER_CHARS} characters.`)
    .optional(),
  language: z
    .string()
    .regex(/^[a-z]{2,3}$/, 'Use a two- or three-letter language code like en.')
    .optional(),
});
export type MastodonSettings = z.infer<typeof mastodonSettingsSchema>;
