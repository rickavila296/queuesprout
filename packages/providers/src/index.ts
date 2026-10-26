/**
 * Worker entry: the full adapter contract, the mock adapter and the adapter registry.
 * apps/web imports "@queuesprout/providers/client" instead (lint-enforced).
 */
import type { ProviderId } from '@queuesprout/shared';
import { getProviderDefinition } from './client';
import { blueskyAdapter } from './bluesky';
import { discordAdapter } from './discord';
import { slackAdapter } from './slack';
import { telegramAdapter } from './telegram';
import { mastodonAdapter } from './mastodon';
import type { ProviderAdapter } from './contract';
import { createMockAdapter, type MockOptions } from './mock/mock-adapter';

export * from './contract';
export * from './mock';
export { BASE_DEFINITIONS, pinterestSettingsSchema } from './definitions';
export { getProviderDefinition } from './client';
export { hasErrors, validateSettings, validateText } from './validate';
export { redact } from './redact';

/** Live adapters, added one per channel starting with the golden Bluesky adapter. */
const LIVE_ADAPTERS: Partial<Record<ProviderId, ProviderAdapter>> = {
  bluesky: blueskyAdapter as ProviderAdapter,
  mastodon: mastodonAdapter as ProviderAdapter,
  discord: discordAdapter as ProviderAdapter,
  telegram: telegramAdapter as ProviderAdapter,
  slack: slackAdapter as ProviderAdapter,
};

export type AdapterResolution =
  { ok: true; adapter: ProviderAdapter; mock: boolean } | { ok: false; error: 'not_implemented' };

/**
 * Picks the adapter for one publish step. The worker calls this with isMock from
 * isMockPublish(PUBLISH_MODE, workspace.is_sandbox), so the UI can never choose
 * live publishing (ADR-019).
 */
export function resolveAdapter(
  provider: ProviderId,
  isMock: boolean,
  mockOptions: MockOptions,
): AdapterResolution {
  if (isMock) {
    return {
      ok: true,
      adapter: createMockAdapter(getProviderDefinition(provider), mockOptions),
      mock: true,
    };
  }
  const live = LIVE_ADAPTERS[provider];
  return live ? { ok: true, adapter: live, mock: false } : { ok: false, error: 'not_implemented' };
}
