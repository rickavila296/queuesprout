import { z } from 'zod';
import { PLATFORM_LIMITS, PROVIDER_IDS, type AuthType, type ProviderId } from '@queuesprout/shared';
import type { ProviderCapabilities, ProviderDefinition } from './contract';
import { validateSettings, validateText } from './validate';

/**
 * Base definitions for all 12 providers: auth type, limits, capabilities and the
 * shared validation. They let sandbox mode run every channel before its real adapter
 * exists. Each real adapter replaces its entry with its own, stricter, definition.
 */

/** ADR-021: a Pinterest channel is the account; every post names its board. */
export const pinterestSettingsSchema = z.object({
  board_id: z.string({ error: 'Choose a board.' }).min(1, 'Choose a board.'),
  title: z.string().max(100).optional(),
  link: z.url().optional(),
});

const noSettings = z.object({});

const META: Record<
  ProviderId,
  { authType: AuthType; capabilities: ProviderCapabilities; settingsSchema: z.ZodType }
> = {
  bluesky: {
    authType: 'app_password',
    capabilities: { threads: true, firstComment: false, asyncProcessing: false },
    settingsSchema: noSettings,
  },
  mastodon: {
    authType: 'oauth2',
    capabilities: { threads: true, firstComment: false, asyncProcessing: false },
    settingsSchema: noSettings,
  },
  discord: {
    authType: 'bot_token',
    capabilities: { threads: false, firstComment: false, asyncProcessing: false },
    settingsSchema: noSettings,
  },
  telegram: {
    authType: 'bot_token',
    capabilities: { threads: false, firstComment: false, asyncProcessing: false },
    settingsSchema: noSettings,
  },
  slack: {
    authType: 'oauth2',
    capabilities: { threads: true, firstComment: false, asyncProcessing: false },
    settingsSchema: noSettings,
  },
  linkedin: {
    authType: 'oauth2',
    capabilities: { threads: false, firstComment: true, asyncProcessing: false },
    settingsSchema: noSettings,
  },
  pinterest: {
    authType: 'oauth2',
    capabilities: { threads: false, firstComment: false, asyncProcessing: false },
    settingsSchema: pinterestSettingsSchema,
  },
  youtube: {
    authType: 'oauth2',
    capabilities: { threads: false, firstComment: false, asyncProcessing: true },
    settingsSchema: noSettings,
  },
  facebook: {
    authType: 'oauth2',
    capabilities: { threads: false, firstComment: true, asyncProcessing: false },
    settingsSchema: noSettings,
  },
  instagram: {
    authType: 'oauth2',
    capabilities: { threads: false, firstComment: true, asyncProcessing: true },
    settingsSchema: noSettings,
  },
  threads: {
    authType: 'oauth2',
    capabilities: { threads: true, firstComment: false, asyncProcessing: true },
    settingsSchema: noSettings,
  },
  tiktok: {
    authType: 'oauth2_pkce',
    capabilities: { threads: false, firstComment: false, asyncProcessing: true },
    settingsSchema: noSettings,
  },
};

function baseDefinition(id: ProviderId): ProviderDefinition {
  const meta = META[id];
  const limits = PLATFORM_LIMITS[id];
  // Base definitions only ever publish through the mock adapter, so images are fine here.
  const capabilities = { ...meta.capabilities, media: true };
  return {
    id,
    authType: meta.authType,
    limits,
    settingsSchema: meta.settingsSchema as z.ZodType<Record<string, unknown>>,
    capabilities,
    validate(post) {
      return [
        ...validateSettings(meta.settingsSchema, post.settings),
        ...validateText(post, limits, capabilities),
      ];
    },
  };
}

export const BASE_DEFINITIONS: Record<ProviderId, ProviderDefinition> = Object.fromEntries(
  PROVIDER_IDS.map((id) => [id, baseDefinition(id)]),
) as Record<ProviderId, ProviderDefinition>;
