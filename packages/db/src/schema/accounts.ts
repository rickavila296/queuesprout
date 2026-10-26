import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ACCOUNT_STATUSES,
  CHANNEL_STATUSES,
  PROVIDER_IDS,
  type TargetType,
} from '@queuesprout/shared';
import { bytea, createdAt, updatedAt } from './columns';
import { profiles, workspaces } from './workspaces';

export const providerId = pgEnum('provider_id', PROVIDER_IDS);
export const accountStatus = pgEnum('account_status', ACCOUNT_STATUSES);
export const channelStatus = pgEnum('channel_status', CHANNEL_STATUSES);

/**
 * OAuth apps registered at runtime, one per Mastodon instance. Shared by every
 * workspace on this install. RLS on with no policies: the web role cannot read it.
 */
export const providerApps = pgTable(
  'provider_apps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: providerId('provider').notNull(),
    /** Normalised origin, e.g. https://mastodon.social. */
    instanceUrl: text('instance_url').notNull(),
    clientId: text('client_id').notNull(),
    clientSecretEnc: bytea('client_secret_enc').notNull(),
    keyVersion: smallint('key_version').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('provider_apps_instance_idx').on(t.provider, t.instanceUrl)],
);

/** One social login: an OAuth grant, an app password or a bot. Secrets live in account_credentials. */
export const connectedAccounts = pgTable(
  'connected_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: providerId('provider').notNull(),
    providerAppId: uuid('provider_app_id').references(() => providerApps.id),
    /** DID, member URN, bot id... */
    externalAccountId: text('external_account_id').notNull(),
    displayName: text('display_name').notNull(),
    /** The account's own server (a Bluesky PDS, a Mastodon instance); null where fixed. */
    serviceUrl: text('service_url'),
    status: accountStatus('status').notNull().default('active'),
    connectedBy: uuid('connected_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('connected_accounts_external_idx').on(
      t.workspaceId,
      t.provider,
      t.externalAccountId,
    ),
    // Target of composite foreign keys that keep children in their parent's workspace.
    unique('connected_accounts_id_workspace_key').on(t.id, t.workspaceId),
    check('connected_accounts_service_url_https', sql`${t.serviceUrl} ~ '^https://'`),
  ],
);

/** A publish destination under an account: profile, page, org, server channel, chat. */
export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').notNull(),
    /** Copied from the account for filtering. */
    provider: providerId('provider').notNull(),
    targetType: text('target_type').$type<TargetType>().notNull(),
    externalTargetId: text('external_target_id').notNull(),
    name: text('name').notNull(),
    handle: text('handle'),
    avatarUrl: text('avatar_url'),
    status: channelStatus('status').notNull().default('active'),
    /** Validated by the adapter's settingsSchema. Pinterest: {"board_id": "..."}. */
    defaultSettings: jsonb('default_settings')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('channels_external_idx').on(t.workspaceId, t.provider, t.externalTargetId),
    index('channels_account_idx').on(t.accountId),
    unique('channels_id_workspace_key').on(t.id, t.workspaceId),
    // Composite, so a channel can never sit under another workspace's account.
    foreignKey({
      name: 'channels_account_fk',
      columns: [t.accountId, t.workspaceId],
      foreignColumns: [connectedAccounts.id, connectedAccounts.workspaceId],
    }).onDelete('cascade'),
  ],
);

/** One in-flight connect flow: state hashed, secrets encrypted, 10-minute expiry, single use. */
export const oauthSessions = pgTable(
  'oauth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** sha256 of the state sent to the provider. */
    stateHash: text('state_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: providerId('provider').notNull(),
    providerAppId: uuid('provider_app_id').references(() => providerApps.id),
    /** PKCE verifier. */
    codeVerifierEnc: bytea('code_verifier_enc'),
    /** Bluesky OAuth DPoP key, copied to the credentials on success. */
    dpopJwkEnc: bytea('dpop_jwk_enc'),
    keyVersion: smallint('key_version'),
    redirectTo: text('redirect_to').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '10 minutes'`),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('oauth_sessions_expires_idx').on(t.expiresAt)],
);
