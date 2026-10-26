import { PLATFORM_LIMITS, type PlatformLimits } from '@queuesprout/shared';

/**
 * Mastodon's defaults: 500 characters, 4 attachments. Instances can raise the character
 * limit (/api/v2/instance); until that is stored per channel, 500 is the safe floor.
 */
export const MASTODON_LIMITS: PlatformLimits = PLATFORM_LIMITS.mastodon;
/** Every link counts as this many characters, whatever its length. */
export const CHARS_PER_URL = 23;
export const MAX_SPOILER_CHARS = 500;

/** Read the profile, write posts; media uploads arrive in Phase 2. */
export const SCOPES = 'read:accounts write:statuses write:media';
