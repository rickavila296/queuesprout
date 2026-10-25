import type { CredentialStore } from '@queuesprout/core/credentials';
import type { Database } from '@queuesprout/db';
import { withLockedCredentials } from '@queuesprout/db/credentials';

/** getFreshToken()'s store, backed by the account_credentials row lock. */
export function createCredentialStore(db: Database): CredentialStore {
  return {
    withLock: (accountId, fn) =>
      withLockedCredentials(db, accountId, (locked) =>
        fn({
          row: {
            accessTokenEnc: locked.row.accessTokenEnc,
            refreshTokenEnc: locked.row.refreshTokenEnc,
            expiresAt: locked.row.expiresAt,
            scopes: locked.row.scopes,
            keyVersion: locked.row.keyVersion,
          },
          save: locked.save,
          markNeedsReauth: locked.markNeedsReauth,
        }),
      ),
  };
}
