import type { ProviderAdapter } from '../contract';
import { connectWithSecret, listTargets, refreshToken } from './auth';
import { publish } from './publish';
import type { DiscordSettings } from './settings';
import { discordDefinition } from './validate';

/** Copies the golden Bluesky layout (CLAUDE.md); a channel webhook instead of a login. */
export const discordAdapter: ProviderAdapter<DiscordSettings> = {
  ...discordDefinition,
  connectWithSecret,
  refreshToken,
  listTargets,
  publish,
};

export { discordDefinition } from './validate';
