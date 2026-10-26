import { z } from 'zod';

/** Per-post Discord options. suppressEmbeds hides link previews under the message. */
export const discordSettingsSchema = z.object({
  suppressEmbeds: z.boolean().optional(),
});
export type DiscordSettings = z.infer<typeof discordSettingsSchema>;
