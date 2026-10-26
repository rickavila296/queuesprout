import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { Database, Tx } from '../client';
import { connectedAccounts } from '../schema/accounts';
import { accountCredentials } from '../schema/credentials';
import { workspaces } from '../schema/workspaces';

/**
 * Credential access for apps/worker only (ADR-010, ADR-017). Exported as
 * "@queuesprout/db/credentials", which lint bans everywhere else. Rows hold
 * ciphertext; encryption and decryption live in @queuesprout/core/credentials.
 */

export type CredentialRow = typeof accountCredentials.$inferSelect;

export interface EncryptedCredentialUpdate {
  accessTokenEnc: Buffer;
  refreshTokenEnc: Buffer | null;
  expiresAt: Date | null;
  scopes: string[];
  keyVersion: number;
}

export class CredentialsNotFoundError extends Error {
  constructor(accountId: string) {
    super(`No credentials for account ${accountId}`);
    this.name = 'CredentialsNotFoundError';
  }
}

/** How long to wait for another job's refresh before giving up. */
export const CREDENTIAL_LOCK_TIMEOUT = '10s';

export interface LockedCredentials {
  row: CredentialRow;
  save(update: EncryptedCredentialUpdate): Promise<void>;
  markNeedsReauth(): Promise<void>;
}

/**
 * Runs fn while holding the row lock on one account's credentials. Every channel
 * under a login shares this row, so two jobs can never rotate a refresh token at
 * once: the second waits, then sees the first one's result. Whatever fn writes
 * through save() or markNeedsReauth() commits when fn returns.
 */
export async function withLockedCredentials<T>(
  db: Database,
  accountId: string,
  fn: (locked: LockedCredentials) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx: Tx) => {
    await tx.execute(sql.raw(`set local lock_timeout = '${CREDENTIAL_LOCK_TIMEOUT}'`));
    const rows = await tx
      .select()
      .from(accountCredentials)
      .where(eq(accountCredentials.accountId, accountId))
      .for('update');
    const row = rows[0];
    if (!row) throw new CredentialsNotFoundError(accountId);

    return fn({
      row,
      async save(update) {
        await tx
          .update(accountCredentials)
          .set({ ...update, refreshedAt: new Date() })
          .where(eq(accountCredentials.accountId, accountId));
      },
      async markNeedsReauth() {
        await tx
          .update(connectedAccounts)
          .set({ status: 'needs_reauth' })
          .where(eq(connectedAccounts.id, accountId));
      },
    });
  });
}

export interface AccountToRefresh {
  accountId: string;
  workspaceId: string;
  provider: (typeof connectedAccounts.$inferSelect)['provider'];
  externalAccountId: string;
  serviceUrl: string | null;
  workspaceIsSandbox: boolean;
}

/** Active accounts with a refresh token whose access token expires before `before`. */
export async function listAccountsToRefresh(
  db: Database,
  before: Date,
  limit = 100,
): Promise<AccountToRefresh[]> {
  return db
    .select({
      accountId: connectedAccounts.id,
      workspaceId: connectedAccounts.workspaceId,
      provider: connectedAccounts.provider,
      externalAccountId: connectedAccounts.externalAccountId,
      serviceUrl: connectedAccounts.serviceUrl,
      workspaceIsSandbox: workspaces.isSandbox,
    })
    .from(accountCredentials)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, accountCredentials.accountId))
    .innerJoin(workspaces, eq(workspaces.id, connectedAccounts.workspaceId))
    .where(
      and(
        eq(connectedAccounts.status, 'active'),
        isNotNull(accountCredentials.refreshTokenEnc),
        lte(accountCredentials.expiresAt, before),
      ),
    )
    .orderBy(asc(accountCredentials.expiresAt))
    .limit(limit);
}
