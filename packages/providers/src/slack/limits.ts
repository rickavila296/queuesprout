import { PLATFORM_LIMITS, type PlatformLimits } from '@queuesprout/shared';
import type { MediaFileSpec } from '../contract';

/** A message: 40,000 characters; a thread is the first message plus replies under it. */
export const SLACK_LIMITS: PlatformLimits = PLATFORM_LIMITS.slack;

export const API_URL = 'https://slack.com/api';
/** Where files.getUploadURLExternal sends uploads; any other host is refused. */
export const UPLOAD_HOST = 'files.slack.com';

/** Images are uploaded as private files, then shown with image blocks in the message. */
export const IMAGE_SPEC: MediaFileSpec = {
  maxBytes: 20_000_000,
  maxEdgePx: 4096,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
};
/** The longest alt_text an image block takes. */
export const MAX_ALT_CHARS = 2000;
/** A section block's text limit; longer posts with images take several sections. */
export const SECTION_CHARS = 3000;
/** Checks for a just-uploaded file to become usable in a message, 2 s apart. */
export const FILE_READY_TRIES = 10;
export const FILE_READY_POLL_MS = 2000;

/** A bot user OAuth token from the app's OAuth & Permissions page. */
export const BOT_TOKEN_PATTERN = /^xoxb-[\w-]{20,250}$/;

/** A public (C…) or private (G…) channel id. */
export const CHANNEL_ID_PATTERN = /^[CG][A-Z0-9]{6,}$/;

/** Slack channel names: lowercase letters, numbers, hyphens and underscores. */
const CHANNEL_NAME = /^#?([a-z0-9][a-z0-9_-]{0,79})$/;

/** What a user typed as a channel: an id, or a name with or without #. */
export function parseChannel(value: string): { id: string } | { name: string } | null {
  const trimmed = value.trim();
  if (CHANNEL_ID_PATTERN.test(trimmed)) return { id: trimmed };
  const name = CHANNEL_NAME.exec(trimmed.toLowerCase())?.[1];
  return name ? { name } : null;
}
