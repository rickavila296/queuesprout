import { smallint, text, timestamp, uuid, pgTable } from 'drizzle-orm/pg-core';
import { connectedAccounts } from './accounts';
import { bytea, updatedAt } from './columns';

/**
 * Secrets, exactly one row per connected account (ADR-010, ADR-017). RLS is on with
 * no policies and the web role has no privileges on it, so only the worker reads it.
 * apps/web writes it only through app.connect_account(). Not exported from
 * ./schema: import "@queuesprout/db/schema/credentials" (lint-restricted).
 */
export const accountCredentials = pgTable('account_credentials', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
  accessTokenEnc: bytea('access_token_enc').notNull(),
  refreshTokenEnc: bytea('refresh_token_enc'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  scopes: text('scopes').array().notNull().default([]),
  /** Bluesky OAuth tokens are DPoP-bound (Phase 4). */
  dpopJwkEnc: bytea('dpop_jwk_enc'),
  keyVersion: smallint('key_version').notNull(),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
  updatedAt: updatedAt(),
});
