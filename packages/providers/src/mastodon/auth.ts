import type { AccountCredentials } from '@queuesprout/shared';
import {
  ConnectError,
  type AccountRef,
  type AppRegistrationContext,
  type AuthContext,
  type AuthStart,
  type CallbackContext,
  type ConnectedAccountInput,
  type RegisteredApp,
  type Target,
} from '../contract';
import { MastodonError } from './errors';
import { mastodon, normalizeInstance } from './http';
import { SCOPES } from './limits';

/**
 * OAuth 2 with one app per instance (registered on first use and stored encrypted in
 * provider_apps), PKCE where the server supports it. Mastodon tokens do not expire;
 * a revoked one fails with 401 and the account needs reconnecting.
 */

interface AppResponse {
  client_id: string;
  client_secret: string;
}

interface TokenResponse {
  access_token: string;
  scope?: string;
}

export interface MastodonAccount {
  id: string;
  username: string;
  acct: string;
  display_name?: string;
  avatar?: string;
  url?: string;
}

function instanceOf(value: string | undefined): string {
  const instance = value ? normalizeInstance(value) : null;
  if (!instance) {
    throw new ConnectError('rejected', 'Enter the public address of your Mastodon server.');
  }
  return instance;
}

function connectFailure(error: unknown, action: string): ConnectError {
  if (error instanceof ConnectError) return error;
  if (error instanceof MastodonError && error.status === 429) {
    return new ConnectError('rate_limited', 'The Mastodon server is busy. Wait a few minutes.');
  }
  if (error instanceof MastodonError && error.status >= 400 && error.status < 500) {
    return new ConnectError('rejected', `The Mastodon server refused to ${action}.`);
  }
  return new ConnectError('unavailable', 'Could not reach the Mastodon server. Try again.');
}

export async function registerApp(ctx: AppRegistrationContext): Promise<RegisteredApp> {
  const instanceUrl = instanceOf(ctx.instanceUrl);
  try {
    const app = await mastodon<AppResponse>('POST', {
      instanceUrl,
      path: '/api/v1/apps',
      body: {
        client_name: ctx.clientName,
        redirect_uris: ctx.redirectUri,
        scopes: SCOPES,
        website: ctx.website,
      },
      signal: ctx.signal,
    });
    if (!app.client_id || !app.client_secret) throw new MastodonError(502, 'No client returned.');
    return { clientId: app.client_id, clientSecret: app.client_secret };
  } catch (error) {
    throw connectFailure(error, 'register QueueSprout');
  }
}

const base64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function getAuthUrl(ctx: AuthContext): Promise<AuthStart> {
  const instanceUrl = instanceOf(ctx.instanceUrl);
  const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))),
  );
  const url = new URL('/oauth/authorize', instanceUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: ctx.clientId,
    redirect_uri: ctx.redirectUri,
    scope: SCOPES,
    state: ctx.state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return { url: url.toString(), codeVerifier };
}

function toTarget(account: MastodonAccount, instanceUrl: string): Target {
  const host = new URL(instanceUrl).host;
  return {
    targetType: 'profile',
    externalTargetId: account.id,
    name: account.display_name?.trim() || `@${account.username}`,
    handle: `@${account.username}@${host}`,
    avatarUrl: account.avatar ?? null,
  };
}

export async function exchangeCode(ctx: CallbackContext): Promise<ConnectedAccountInput> {
  const instanceUrl = instanceOf(ctx.instanceUrl);
  let token: TokenResponse;
  try {
    token = await mastodon<TokenResponse>('POST', {
      instanceUrl,
      path: '/oauth/token',
      body: {
        grant_type: 'authorization_code',
        code: ctx.code,
        client_id: ctx.clientId,
        client_secret: ctx.clientSecret,
        redirect_uri: ctx.redirectUri,
        scope: SCOPES,
        ...(ctx.codeVerifier && { code_verifier: ctx.codeVerifier }),
      },
      signal: ctx.signal,
    });
  } catch (error) {
    throw connectFailure(error, 'finish signing in');
  }

  let account: MastodonAccount;
  try {
    account = await verifyCredentials(instanceUrl, token.access_token, ctx.signal);
  } catch (error) {
    throw connectFailure(error, 'share your profile');
  }
  const target = toTarget(account, instanceUrl);
  return {
    // Account ids are only unique per server.
    externalAccountId: `${account.id}@${new URL(instanceUrl).host}`,
    displayName: target.handle ?? target.name,
    serviceUrl: instanceUrl,
    creds: {
      accessToken: token.access_token,
      refreshToken: null,
      expiresAt: null,
      scopes: (token.scope ?? SCOPES).split(/\s+/).filter(Boolean),
    },
    targets: [target],
  };
}

export function verifyCredentials(
  instanceUrl: string,
  token: string,
  signal: AbortSignal,
): Promise<MastodonAccount> {
  return mastodon<MastodonAccount>('GET', {
    instanceUrl,
    path: '/api/v1/accounts/verify_credentials',
    token,
    signal,
  });
}

/** Mastodon tokens do not expire, so there is nothing to refresh. */
export async function refreshToken(creds: AccountCredentials): Promise<AccountCredentials> {
  return creds;
}

export async function listTargets(
  creds: AccountCredentials,
  signal: AbortSignal,
  account: AccountRef,
): Promise<Target[]> {
  const instanceUrl = instanceOf(account.serviceUrl ?? undefined);
  return [toTarget(await verifyCredentials(instanceUrl, creds.accessToken, signal), instanceUrl)];
}
