import { InvalidGrantError, type AccountCredentials } from '@queuesprout/shared';
import {
  ConnectError,
  type AccountRef,
  type ConnectedAccountInput,
  type SecretConnectContext,
  type Target,
} from '../contract';
import { GRANT_GONE, XrpcError } from './errors';
import { isPublicHttpsUrl } from '../net';
import { ENTRYWAY_URL } from './limits';
import { xrpc } from './xrpc';

/**
 * App Password sign-in (ADR-018). createSession returns a short-lived access JWT and a
 * long-lived refresh JWT; refreshSession rotates both. AT Protocol OAuth replaces this
 * in Phase 4.
 */

/** Bluesky app passwords look like abcd-efgh-ijkl-mnop. The account password is refused. */
export const APP_PASSWORD_PATTERN = /^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/i;

interface SessionResponse {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
  didDoc?: { service?: { id?: string; type?: string; serviceEndpoint?: unknown }[] };
  active?: boolean;
}

interface ProfileResponse {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

/** "@Alice" -> "alice.bsky.social"; a full domain handle stays as it is, lowercased. */
export function normalizeHandle(input: string): string {
  const handle = input.trim().replace(/^@/, '').toLowerCase();
  return handle.includes('.') || handle.startsWith('did:') ? handle : `${handle}.bsky.social`;
}

/** The JWT's exp claim. The signature is not checked: the server does that. */
export function jwtExpiry(token: string): Date | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof json.exp === 'number' ? new Date(json.exp * 1000) : null;
  } catch {
    return null;
  }
}

/** The account's PDS from its DID document, so later calls go straight to it. */
export function pdsFromDidDoc(didDoc: SessionResponse['didDoc']): string | null {
  const service = didDoc?.service?.find(
    (s) => s.id?.endsWith('#atproto_pds') || s.type === 'AtprotoPersonalDataServer',
  );
  const url = typeof service?.serviceEndpoint === 'string' ? service.serviceEndpoint : null;
  return url && /^https:\/\//.test(url) ? url.replace(/\/$/, '') : null;
}

const toCreds = (session: { accessJwt: string; refreshJwt: string }): AccountCredentials => ({
  accessToken: session.accessJwt,
  refreshToken: session.refreshJwt,
  expiresAt: jwtExpiry(session.accessJwt),
  scopes: ['app_password'],
});

export async function connectWithSecret(ctx: SecretConnectContext): Promise<ConnectedAccountInput> {
  if (!APP_PASSWORD_PATTERN.test(ctx.secret.trim())) {
    throw new ConnectError(
      'invalid_credentials',
      'Use an app password (Settings > Privacy and security > App passwords), not your account password.',
    );
  }
  const signInService = (ctx.instanceUrl ?? ENTRYWAY_URL).replace(/\/$/, '');
  if (!isPublicHttpsUrl(signInService)) {
    throw new ConnectError('rejected', 'Use the public https address of your Bluesky server.');
  }
  let session: SessionResponse;
  try {
    session = await xrpc<SessionResponse>('POST', {
      service: signInService,
      nsid: 'com.atproto.server.createSession',
      body: { identifier: normalizeHandle(ctx.identifier), password: ctx.secret.trim() },
      signal: ctx.signal,
    });
  } catch (error) {
    if (error instanceof XrpcError && error.status === 429) {
      throw new ConnectError('rate_limited', 'Too many sign-in attempts. Wait a few minutes.');
    }
    if (error instanceof XrpcError && (error.status === 401 || error.status === 400)) {
      throw new ConnectError(
        'invalid_credentials',
        'Bluesky did not accept that handle and app password.',
      );
    }
    throw new ConnectError('unavailable', 'Could not reach Bluesky. Try again in a moment.');
  }
  if (session.active === false) {
    throw new ConnectError('rejected', 'This Bluesky account is deactivated or suspended.');
  }

  const pds = pdsFromDidDoc(session.didDoc);
  if (pds && !isPublicHttpsUrl(pds)) {
    throw new ConnectError(
      'rejected',
      'This account is hosted on a server QueueSprout cannot reach.',
    );
  }
  const serviceUrl = pds ?? signInService;
  const account: AccountRef = { externalId: session.did, serviceUrl };
  const creds = toCreds(session);
  const targets = await listTargets(creds, ctx.signal, account).catch(() => [
    profileTarget({ did: session.did, handle: session.handle }),
  ]);
  return {
    externalAccountId: session.did,
    displayName: `@${session.handle}`,
    serviceUrl,
    creds,
    targets,
  };
}

/** Rotates both JWTs. A revoked app password or a dead session throws InvalidGrantError. */
export async function refreshToken(
  creds: AccountCredentials,
  signal: AbortSignal,
  account: AccountRef,
): Promise<AccountCredentials> {
  if (!creds.refreshToken) throw new InvalidGrantError('no refresh token');
  try {
    const session = await xrpc<SessionResponse>('POST', {
      service: account.serviceUrl ?? ENTRYWAY_URL,
      nsid: 'com.atproto.server.refreshSession',
      token: creds.refreshToken,
      signal,
    });
    return toCreds(session);
  } catch (error) {
    if (
      error instanceof XrpcError &&
      (error.status === 401 ||
        error.error === 'ExpiredToken' ||
        (error.error !== undefined && GRANT_GONE.has(error.error)))
    ) {
      throw new InvalidGrantError(error.error ?? 'invalid_grant');
    }
    throw error;
  }
}

function profileTarget(p: {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}): Target {
  return {
    targetType: 'profile',
    externalTargetId: p.did,
    name: p.displayName?.trim() || `@${p.handle}`,
    handle: `@${p.handle}`,
    avatarUrl: p.avatar ?? null,
  };
}

/** A Bluesky login posts to one place: its own profile. */
export async function listTargets(
  creds: AccountCredentials,
  signal: AbortSignal,
  account: AccountRef,
): Promise<Target[]> {
  const profile = await xrpc<ProfileResponse>('GET', {
    service: account.serviceUrl ?? ENTRYWAY_URL,
    nsid: 'app.bsky.actor.getProfile',
    params: { actor: account.externalId },
    token: creds.accessToken,
    signal,
  });
  return [profileTarget(profile)];
}
