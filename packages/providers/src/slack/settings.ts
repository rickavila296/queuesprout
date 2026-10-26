import { z } from 'zod';

/** Per-post Slack options. disableUnfurl hides link and media previews under the message. */
export const slackSettingsSchema = z.object({
  disableUnfurl: z.boolean().optional(),
});
export type SlackSettings = z.infer<typeof slackSettingsSchema>;
