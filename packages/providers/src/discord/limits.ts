import { PLATFORM_LIMITS, type PlatformLimits } from '@queuesprout/shared';

/** A webhook message: 2,000 characters, up to 10 attachments, no threads of our own. */
export const DISCORD_LIMITS: PlatformLimits = PLATFORM_LIMITS.discord;

export const API_URL = 'https://discord.com/api/v10';
export const WEB_URL = 'https://discord.com/channels';

/** Message flag that hides link previews. */
export const SUPPRESS_EMBEDS = 1 << 2;

/** https://discord.com/api/webhooks/<id>/<token>, also on the ptb, canary and legacy hosts. */
export const WEBHOOK_URL_PATTERN =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{17,20})\/([\w-]{60,100})\/?$/;
