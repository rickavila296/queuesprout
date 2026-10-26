import { PLATFORM_LIMITS, type PlatformLimits } from '@queuesprout/shared';

/** A message: 40,000 characters; a thread is the first message plus replies under it. */
export const SLACK_LIMITS: PlatformLimits = PLATFORM_LIMITS.slack;

export const API_URL = 'https://slack.com/api';

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
