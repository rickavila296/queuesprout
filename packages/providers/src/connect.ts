/**
 * apps/web server entry for connecting accounts: sign-in and OAuth calls only.
 * Nothing here publishes, refreshes tokens or reads stored credentials; those stay
 * in apps/worker (CLAUDE.md package boundaries).
 */
import type { ProviderId } from '@queuesprout/shared';
import { connectWithSecret as blueskyConnect } from './bluesky/auth';
import type { ConnectedAccountInput, SecretConnectContext } from './contract';

export { ConnectError } from './contract';
export type { ConnectedAccountInput, SecretConnectContext, Target } from './contract';
export { APP_PASSWORD_PATTERN as BLUESKY_APP_PASSWORD_PATTERN } from './bluesky/auth';

type SecretConnector = (ctx: SecretConnectContext) => Promise<ConnectedAccountInput>;

/** Providers connected by pasting a secret (app password, bot token). */
const SECRET_CONNECTORS: Partial<Record<ProviderId, SecretConnector>> = {
  bluesky: blueskyConnect,
};

export function secretConnector(provider: ProviderId): SecretConnector | null {
  return SECRET_CONNECTORS[provider] ?? null;
}
