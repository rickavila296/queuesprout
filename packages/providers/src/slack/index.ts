import type { ProviderAdapter } from '../contract';
import { connectWithSecret, listTargets, refreshToken } from './auth';
import { publish } from './publish';
import type { SlackSettings } from './settings';
import { slackDefinition } from './validate';

/** Copies the golden Bluesky layout (CLAUDE.md); a bot token instead of a login. */
export const slackAdapter: ProviderAdapter<SlackSettings> = {
  ...slackDefinition,
  connectWithSecret,
  refreshToken,
  listTargets,
  publish,
};

export { slackDefinition } from './validate';
