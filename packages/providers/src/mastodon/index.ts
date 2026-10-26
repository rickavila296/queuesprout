import type { ProviderAdapter } from '../contract';
import { exchangeCode, getAuthUrl, listTargets, refreshToken, registerApp } from './auth';
import { publish } from './publish';
import type { MastodonSettings } from './settings';
import { mastodonDefinition } from './validate';

/** Copies the golden Bluesky layout (CLAUDE.md); OAuth instead of an app password. */
export const mastodonAdapter: ProviderAdapter<MastodonSettings> = {
  ...mastodonDefinition,
  registerApp,
  getAuthUrl,
  exchangeCode,
  refreshToken,
  listTargets,
  publish,
};

export { mastodonDefinition } from './validate';
export { normalizeInstance } from './http';
