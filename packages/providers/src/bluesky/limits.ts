import { PLATFORM_LIMITS, type PlatformLimits } from '@queuesprout/shared';

/** Where accounts hosted by Bluesky sign in. Self-hosted PDS users give their own URL. */
export const ENTRYWAY_URL = 'https://bsky.social';

/** app.bsky.feed.post: 300 graphemes and 3,000 UTF-8 bytes of text. */
export const BLUESKY_LIMITS: PlatformLimits = PLATFORM_LIMITS.bluesky;
export const MAX_TEXT_BYTES = 3000;
/** Facet tags (hashtags) are capped at 64 graphemes. */
export const MAX_TAG_GRAPHEMES = 64;
export const MAX_LANGS = 3;

/**
 * app.bsky.embed.images: up to 4 images of at most 1,000,000 bytes each. The app scales
 * images to 2000 px on the long side, so larger ones only cost upload time.
 */
export const IMAGE_SPEC = {
  maxBytes: 1_000_000,
  maxEdgePx: 2000,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
} as const;
/** Bluesky's alt text limit, in graphemes. */
export const MAX_ALT_GRAPHEMES = 2000;

export const POST_COLLECTION = 'app.bsky.feed.post';
export const POST_WEB_URL = 'https://bsky.app/profile';
