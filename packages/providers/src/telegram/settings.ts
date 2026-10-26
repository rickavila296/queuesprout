import { z } from 'zod';

/**
 * Per-post Telegram options. disableLinkPreview hides the preview card under a link;
 * silent delivers the message without a notification sound.
 */
export const telegramSettingsSchema = z.object({
  disableLinkPreview: z.boolean().optional(),
  silent: z.boolean().optional(),
});
export type TelegramSettings = z.infer<typeof telegramSettingsSchema>;
