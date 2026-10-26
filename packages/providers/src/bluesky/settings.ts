import { z } from 'zod';
import { MAX_LANGS } from './limits';

/** Per-post Bluesky options. langs tells feeds and translation which languages the post is in. */
export const blueskySettingsSchema = z.object({
  langs: z
    .array(
      z
        .string()
        .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/, 'Use a language code like en or pt-BR.'),
    )
    .max(MAX_LANGS, `At most ${MAX_LANGS} languages.`)
    .optional(),
});
export type BlueskySettings = z.infer<typeof blueskySettingsSchema>;
