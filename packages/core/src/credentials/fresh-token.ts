import { InvalidGrantError, type AccountCredentials } from '@queuesprout/shared';
import {
  accountSecretContext,
  decryptSecret,
  encryptSecret,
  type AccountKey,
  type Keyring,
} from './crypto';

/** Ciphertext as stored in account_credentials. */
export interface EncryptedCredentials {
  accessTokenEnc: Buffer;
  refreshTokenEnc: Buffer | null;
  expiresAt: Date | null;
  scopes: string[];
  keyVersion: number;
}

/**
 * The credentials row, held under its row lock. The worker implements this with
 * withLockedCredentials() from "@queuesprout/db/credentials"; core stays free of SQL.
 */
export interface LockedCredentialsRow {
  row: EncryptedCredentials;
  save(update: EncryptedCredentials): Promise<void>;
  markNeedsReauth(): Promise<void>;
}

export interface CredentialStore {
  withLock<T>(accountId: string, fn: (locked: LockedCredentialsRow) => Promise<T>): Promise<T>;
}

export type FreshTokenResult =
  | { ok: true; creds: AccountCredentials; refreshed: boolean }
  | { ok: false; error: 'needs_reauth' | 'refresh_failed'; message: string };

export interface GetFreshTokenOptions {
  store: CredentialStore;
  keyring: Keyring;
  accountId: string;
  account: AccountKey;
  /** The adapter's refreshToken(). Throw InvalidGrantError when the grant is revoked. */
  refresh: (creds: AccountCredentials) => Promise<AccountCredentials>;
  now?: () => Date;
  /** Refresh this long before expiry so a token never dies mid-step. Default 5 minutes. */
  skewMs?: number;
}

export const DEFAULT_REFRESH_SKEW_MS = 5 * 60_000;

export function encryptCredentials(
  keyring: Keyring,
  account: AccountKey,
  creds: AccountCredentials,
): EncryptedCredentials {
  return {
    accessTokenEnc: encryptSecret(
      keyring,
      creds.accessToken,
      accountSecretContext(account, 'access_token'),
    ),
    refreshTokenEnc:
      creds.refreshToken === null
        ? null
        : encryptSecret(
            keyring,
            creds.refreshToken,
            accountSecretContext(account, 'refresh_token'),
          ),
    expiresAt: creds.expiresAt,
    scopes: creds.scopes,
    keyVersion: keyring.currentVersion,
  };
}

export function decryptCredentials(
  keyring: Keyring,
  account: AccountKey,
  row: EncryptedCredentials,
): AccountCredentials {
  return {
    accessToken: decryptSecret(
      keyring,
      row.accessTokenEnc,
      accountSecretContext(account, 'access_token'),
    ),
    refreshToken:
      row.refreshTokenEnc === null
        ? null
        : decryptSecret(
            keyring,
            row.refreshTokenEnc,
            accountSecretContext(account, 'refresh_token'),
          ),
    expiresAt: row.expiresAt,
    scopes: row.scopes,
  };
}

/**
 * Returns usable credentials, refreshing them under the row lock if they are about
 * to expire. Because the expiry is
 * re-checked after the lock is taken, a job that waited behind another job's
 * refresh uses the new token instead of refreshing again, so rotating refresh
 * tokens never race. The rotated refresh token is saved before the lock is released.
 */
export async function getFreshToken(options: GetFreshTokenOptions): Promise<FreshTokenResult> {
  const { store, keyring, accountId, account, refresh } = options;
  const now = options.now ?? (() => new Date());
  const skewMs = options.skewMs ?? DEFAULT_REFRESH_SKEW_MS;

  return store.withLock(accountId, async (locked): Promise<FreshTokenResult> => {
    const current = decryptCredentials(keyring, account, locked.row);
    const expiresAt = current.expiresAt?.getTime();
    if (expiresAt === undefined || expiresAt - skewMs > now().getTime()) {
      return { ok: true, creds: current, refreshed: false };
    }

    let next: AccountCredentials;
    try {
      next = await refresh(current);
    } catch (error) {
      if (error instanceof InvalidGrantError) {
        await locked.markNeedsReauth();
        return { ok: false, error: 'needs_reauth', message: 'Reconnect this account.' };
      }
      // Transient: keep the old row; the step's retry policy decides what happens next.
      const message = error instanceof Error ? error.message : 'Token refresh failed';
      return { ok: false, error: 'refresh_failed', message };
    }

    // Some platforms rotate the refresh token, some return none: keep the old one then.
    const merged: AccountCredentials = {
      ...next,
      refreshToken: next.refreshToken ?? current.refreshToken,
    };
    await locked.save(encryptCredentials(keyring, account, merged));
    return { ok: true, creds: merged, refreshed: true };
  });
}
