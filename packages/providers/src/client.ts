/**
 * Browser- and apps/web-safe entry: limits, settings schemas and validate() only.
 * Nothing here publishes, refreshes tokens or decrypts anything.
 */
import type { ProviderId } from '@queuesprout/shared';
import type { ProviderDefinition } from './contract';
import { BASE_DEFINITIONS } from './definitions';

export type {
  ChannelPost,
  MediaInfo,
  PostItem,
  ProviderCapabilities,
  ProviderDefinition,
  Target,
  ValidationIssue,
} from './contract';
export { pinterestSettingsSchema } from './definitions';
export { hasErrors } from './validate';
export { MOCK_FAILURES, demoAccount } from './mock/mock-adapter';

/** Real adapters register their definitions here as they land; the rest use the base ones. */
const DEFINITIONS: Record<ProviderId, ProviderDefinition> = { ...BASE_DEFINITIONS };

export function getProviderDefinition(id: ProviderId): ProviderDefinition {
  return DEFINITIONS[id];
}
