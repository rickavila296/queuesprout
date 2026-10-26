/**
 * apps/web server entry for connecting accounts: sign-in and OAuth calls only.
 * Nothing here publishes, refreshes tokens or reads stored credentials; those stay
 * in apps/worker (CLAUDE.md package boundaries).
 */
import type { ProviderId } from '@queuesprout/shared';
import { connectWithSecret as blueskyConnect } from './bluesky/auth';
import { connectWithSecret as discordConnect } from './discord/auth';
import {
  exchangeCode as mastodonExchange,
  getAuthUrl as mastodonAuthUrl,
  registerApp as mastodonRegister,
} from './mastodon/auth';
import type {
  AppRegistrationContext,
  AuthContext,
  AuthStart,
  CallbackContext,
  ConnectedAccountInput,
  RegisteredApp,
  SecretConnectContext,
} from './contract';

export { ConnectError } from './contract';
export type {
  AppRegistrationContext,
  AuthContext,
  AuthStart,
  CallbackContext,
  ConnectedAccountInput,
  RegisteredApp,
  SecretConnectContext,
  Target,
} from './contract';
export { normalizeInstance as normalizeMastodonInstance } from './mastodon/http';
export { WEBHOOK_URL_PATTERN as DISCORD_WEBHOOK_URL_PATTERN } from './discord/limits';
export { APP_PASSWORD_PATTERN as BLUESKY_APP_PASSWORD_PATTERN } from './bluesky/auth';

type SecretConnector = (ctx: SecretConnectContext) => Promise<ConnectedAccountInput>;

/** Providers connected by pasting a secret (app password, bot token). */
const SECRET_CONNECTORS: Partial<Record<ProviderId, SecretConnector>> = {
  bluesky: blueskyConnect,
  discord: discordConnect,
};

export function secretConnector(provider: ProviderId): SecretConnector | null {
  return SECRET_CONNECTORS[provider] ?? null;
}

/** Providers connected through an OAuth redirect. */
export interface OAuthConnector {
  /** Set where each server needs its own registered app (Mastodon). */
  registerApp?: (ctx: AppRegistrationContext) => Promise<RegisteredApp>;
  getAuthUrl: (ctx: AuthContext) => Promise<AuthStart>;
  exchangeCode: (ctx: CallbackContext) => Promise<ConnectedAccountInput>;
}

const OAUTH_CONNECTORS: Partial<Record<ProviderId, OAuthConnector>> = {
  mastodon: {
    registerApp: mastodonRegister,
    getAuthUrl: mastodonAuthUrl,
    exchangeCode: mastodonExchange,
  },
};

export function oauthConnector(provider: ProviderId): OAuthConnector | null {
  return OAUTH_CONNECTORS[provider] ?? null;
}
