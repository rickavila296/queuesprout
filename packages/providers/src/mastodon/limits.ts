import type { MediaFileSpec } from '../contract';
import { PLATFORM_LIMITS, type PlatformLimits } from '@queuesprout/shared';

/**
 * Mastodon's defaults: 500 characters, 4 attachments. Instances can raise the character
 * limit (/api/v2/instance); until that is stored per channel, 500 is the safe floor.
 */
export const MASTODON_LIMITS: PlatformLimits = PLATFORM_LIMITS.mastodon;
/** Every link counts as this many characters, whatever its length. */
export const CHARS_PER_URL = 23;
export const MAX_SPOILER_CHARS = 500;

/**
 * Images are fitted to what every Mastodon 4.x server takes: 8 MB (newer servers allow 16)
 * and 8.3 megapixels, which a 2880 px square stays within. Servers shrink larger images.
 */
export const IMAGE_SPEC: MediaFileSpec = {
  maxBytes: 8_000_000,
  maxEdgePx: 2880,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
};
/** Mastodon's default limit on a media description. */
export const MAX_ALT_CHARS = 1500;
/** How long to wait before asking again whether an upload has been processed. */
export const MEDIA_POLL_MS = 2000;

/** Read the profile, write posts and upload their media. */
export const SCOPES = 'read:accounts write:statuses write:media';
