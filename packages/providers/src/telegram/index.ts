import type { ProviderAdapter } from '../contract';
import { connectWithSecret, listTargets, refreshToken } from './auth';
import { publish } from './publish';
import type { TelegramSettings } from './settings';
import { telegramDefinition } from './validate';

/** Copies the golden Bluesky layout (CLAUDE.md); a bot token instead of a login. */
export const telegramAdapter: ProviderAdapter<TelegramSettings> = {
  ...telegramDefinition,
  connectWithSecret,
  refreshToken,
  listTargets,
  publish,
};

export { telegramDefinition } from './validate';
