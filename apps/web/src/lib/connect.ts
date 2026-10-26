import 'server-only';
import { ForbiddenError } from '@queuesprout/auth';
import { encryptCredentials, type Keyring } from '@queuesprout/core/credentials';
import { connectAccount, upsertChannel, type WorkspaceContext } from '@queuesprout/db';
import type { ConnectedAccountInput } from '@queuesprout/providers/connect';
import type { ProviderId } from '@queuesprout/shared';
import { env } from '@/env';
import { dataAccess } from './db';

/**
 * Encrypts a freshly connected account's tokens and stores the account and its channels
 * (app.connect_account + upsertChannel). Call after the provider's network calls, never
 * inside them, so no transaction waits on the platform.
 */
export async function saveConnectedAccount(
  ctx: WorkspaceContext,
  keys: Keyring,
  provider: ProviderId,
  account: ConnectedAccountInput,
  providerAppId: string | null = null,
): Promise<void> {
  await dataAccess().withWorkspace(ctx, async (tx) => {
    const encrypted = encryptCredentials(
      keys,
      { workspaceId: ctx.workspaceId, provider, externalAccountId: account.externalAccountId },
      account.creds,
    );
    const connected = await connectAccount(tx, {
      workspaceId: ctx.workspaceId,
      provider,
      providerAppId,
      externalAccountId: account.externalAccountId,
      displayName: account.displayName,
      serviceUrl: account.serviceUrl ?? null,
      ...encrypted,
    });
    if (!connected.ok) throw new ForbiddenError('admin');
    for (const target of account.targets) {
      await upsertChannel(tx, {
        workspaceId: ctx.workspaceId,
        accountId: connected.accountId,
        provider,
        targetType: target.targetType,
        externalTargetId: target.externalTargetId,
        name: target.name,
        handle: target.handle ?? null,
        avatarUrl: target.avatarUrl ?? null,
        defaultSettings: target.defaultSettings ?? {},
      });
    }
  });
}

/** Where a provider sends the user back after its consent screen. */
export const oauthRedirectUri = (provider: ProviderId) =>
  new URL(`/api/oauth/${provider}/callback`, env().PUBLIC_URL).toString();

/** Results the callback reports on the Channels page, by code, never by free text. */
export const CONNECT_RESULTS = {
  connected: 'Account connected.',
  cancelled: 'Connecting was cancelled.',
  expired: 'That sign-in link expired or was already used. Try again.',
  rejected: 'The server refused the connection. Try again, or check the server address.',
  unavailable: 'Could not reach the server. Try again in a moment.',
  rate_limited: 'The server is busy. Wait a few minutes and try again.',
  failed: 'Something went wrong while connecting. Try again.',
} as const;
export type ConnectResult = keyof typeof CONNECT_RESULTS;
