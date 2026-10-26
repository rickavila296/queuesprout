import { createHash, randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, type Keyring } from './crypto';

/**
 * Secrets of the OAuth connect flow, which apps/web handles: a provider app's client
 * secret (one per Mastodon instance) and an in-flight session's PKCE verifier. Account
 * tokens are not among them; only apps/worker decrypts those.
 */

export interface ProviderAppKey {
  provider: string;
  /** Normalised origin, e.g. https://mastodon.social. */
  instanceUrl: string;
}

export type OAuthSessionField = 'code_verifier' | 'dpop_jwk';

export const providerAppSecretContext = (app: ProviderAppKey) =>
  `provider_apps:${app.provider}:${app.instanceUrl}:client_secret`;

export const oauthSessionContext = (stateHash: string, field: OAuthSessionField) =>
  `oauth_sessions:${stateHash}:${field}`;

export const encryptAppSecret = (keyring: Keyring, app: ProviderAppKey, secret: string) =>
  encryptSecret(keyring, secret, providerAppSecretContext(app));

export const decryptAppSecret = (keyring: Keyring, app: ProviderAppKey, blob: Buffer) =>
  decryptSecret(keyring, blob, providerAppSecretContext(app));

export const encryptOAuthSecret = (
  keyring: Keyring,
  stateHash: string,
  field: OAuthSessionField,
  secret: string,
) => encryptSecret(keyring, secret, oauthSessionContext(stateHash, field));

export const decryptOAuthSecret = (
  keyring: Keyring,
  stateHash: string,
  field: OAuthSessionField,
  blob: Buffer,
) => decryptSecret(keyring, blob, oauthSessionContext(stateHash, field));

/** A fresh, unguessable OAuth state (256 bits, base64url). */
export const newOAuthState = () => randomBytes(32).toString('base64url');

/** Only this hash is stored, so a database read cannot replay a pending sign-in. */
export const hashOAuthState = (state: string) =>
  createHash('sha256').update(state, 'utf8').digest('hex');
