import { PLATFORM_LIMITS, type PlatformLimits } from '@queuesprout/shared';
import type { MediaFileSpec } from '../contract';

/** A text message: 4,096 characters, no threads of our own. */
export const TELEGRAM_LIMITS: PlatformLimits = PLATFORM_LIMITS.telegram;

/** A caption on photos is much shorter than a text message. */
export const MAX_CAPTION_CHARS = 1024;
/** sendPhoto takes up to 10 MB, with width plus height at most 10,000 pixels. */
export const IMAGE_SPEC: MediaFileSpec = {
  maxBytes: 10_000_000,
  maxEdgePx: 5000,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
};

export const API_URL = 'https://api.telegram.org';
export const WEB_URL = 'https://t.me';

/** The token @BotFather gives out: <bot id>:<secret>. */
export const BOT_TOKEN_PATTERN = /^(\d{5,15}):[\w-]{30,50}$/;

/** A public username, with or without @ or a t.me link. */
const USERNAME = /^(?:@|(?:https:\/\/)?t\.me\/)?([a-zA-Z][\w]{3,31})\/?$/;
/** A numeric chat id: channels and supergroups start with -100. */
const CHAT_ID = /^-?\d{5,20}$/;

/** Normalises what a user typed into a chat_id Telegram accepts: @name or a number. */
export function normalizeChat(value: string): string | null {
  const trimmed = value.trim();
  if (CHAT_ID.test(trimmed)) return trimmed;
  const name = USERNAME.exec(trimmed)?.[1];
  return name ? `@${name}` : null;
}
