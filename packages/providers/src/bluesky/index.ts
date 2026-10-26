import type { ProviderAdapter } from '../contract';
import { connectWithSecret, listTargets, refreshToken } from './auth';
import { publish } from './publish';
import type { BlueskySettings } from './settings';
import { blueskyDefinition } from './validate';

/**
 * The golden adapter (CLAUDE.md): every new adapter copies this folder's layout.
 * index.ts wires the parts; auth.ts signs in and refreshes; publish.ts does one bounded
 * step; validate.ts, settings.ts and limits.ts are browser-safe; errors.ts maps every
 * platform failure to an errorKind.
 */
export const blueskyAdapter: ProviderAdapter<BlueskySettings> = {
  ...blueskyDefinition,
  connectWithSecret,
  refreshToken,
  listTargets,
  publish,
};

export { blueskyDefinition } from './validate';
export { APP_PASSWORD_PATTERN, normalizeHandle } from './auth';
