import { PLATFORM_LIMITS, type PlatformLimits } from '@queuesprout/shared';
import type { MediaFileSpec } from '../contract';

/** A webhook message: 2,000 characters, up to 10 attachments, no threads of our own. */
export const DISCORD_LIMITS: PlatformLimits = PLATFORM_LIMITS.discord;

export const API_URL = 'https://discord.com/api/v10';
export const WEB_URL = 'https://discord.com/channels';

/** Message flag that hides link previews. */
export const SUPPRESS_EMBEDS = 1 << 2;

/** https://discord.com/api/webhooks/<id>/<token>, also on the ptb, canary and legacy hosts. */
export const WEBHOOK_URL_PATTERN =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{17,20})\/([\w-]{60,100})\/?$/;

/**
 * A webhook message may carry 10 MiB of files in total on a server without boosts, so
 * the images of one message share 9.5 MB (the rest is room for the JSON part).
 */
export const MESSAGE_FILE_BYTES = 9_500_000;
export const imageSpec = (count: number): MediaFileSpec => ({
  maxBytes: Math.floor(MESSAGE_FILE_BYTES / Math.max(count, 1)),
  maxEdgePx: 4096,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
});
/** The longest attachment description (alt text) Discord accepts. */
export const MAX_ALT_CHARS = 1024;
