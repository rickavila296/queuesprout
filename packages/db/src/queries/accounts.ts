import { and, asc, eq, sql } from 'drizzle-orm';
import type { ProviderId, TargetType } from '@queuesprout/shared';
import type { Tx } from '../client';
import { PG_INSUFFICIENT_PRIVILEGE, findPgError } from '../errors';
import { channels, connectedAccounts } from '../schema/accounts';

export interface ConnectAccountInput {
  workspaceId: string;
  provider: ProviderId;
  providerAppId?: string | null;
  externalAccountId: string;
  displayName: string;
  /** Ciphertext from @queuesprout/core/credentials; plaintext never reaches the database. */
  accessTokenEnc: Buffer;
  refreshTokenEnc?: Buffer | null;
  expiresAt?: Date | null;
  scopes?: string[];
  keyVersion: number;
}

/**
 * Creates or reconnects an account with its encrypted secrets (app.connect_account).
 * Admins only; run inside withWorkspace().
 */
export async function connectAccount(
  tx: Tx,
  input: ConnectAccountInput,
): Promise<{ ok: true; accountId: string } | { ok: false; error: 'forbidden' }> {
  try {
    const result = await tx.execute<{ id: string }>(sql`
      select app.connect_account(
        ${input.workspaceId}::uuid, ${input.provider}::provider_id, ${input.providerAppId ?? null}::uuid,
        ${input.externalAccountId}, ${input.displayName},
        ${input.accessTokenEnc}::bytea, ${input.refreshTokenEnc ?? null}::bytea,
        ${input.expiresAt?.toISOString() ?? null}::timestamptz,
        ${sql.param(input.scopes ?? [])}::text[], ${input.keyVersion}::smallint
      ) as id`);
    const id = result.rows[0]?.id;
    if (!id) throw new Error('connect_account returned no id');
    return { ok: true, accountId: id };
  } catch (error) {
    if (findPgError(error)?.code === PG_INSUFFICIENT_PRIVILEGE) {
      return { ok: false, error: 'forbidden' };
    }
    throw error;
  }
}

export interface CreateChannelInput {
  workspaceId: string;
  accountId: string;
  provider: ProviderId;
  targetType: TargetType;
  externalTargetId: string;
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  defaultSettings?: Record<string, unknown>;
}

/** Adds a channel, or refreshes its name and avatar when it already exists. Admins only. */
export async function upsertChannel(tx: Tx, input: CreateChannelInput) {
  const rows = await tx
    .insert(channels)
    .values(input)
    .onConflictDoUpdate({
      target: [channels.workspaceId, channels.provider, channels.externalTargetId],
      set: { name: input.name, handle: input.handle ?? null, avatarUrl: input.avatarUrl ?? null },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('upsertChannel returned no row');
  return row;
}

export interface ChannelSummary {
  id: string;
  provider: ProviderId;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  defaultSettings: Record<string, unknown>;
  channelStatus: (typeof channels.$inferSelect)['status'];
  accountId: string;
  accountStatus: (typeof connectedAccounts.$inferSelect)['status'];
}

/** Channels in a workspace with their account's status (needs_reauth shows on every channel). */
export async function listChannels(tx: Tx, workspaceId: string): Promise<ChannelSummary[]> {
  return tx
    .select({
      id: channels.id,
      provider: channels.provider,
      name: channels.name,
      handle: channels.handle,
      avatarUrl: channels.avatarUrl,
      defaultSettings: channels.defaultSettings,
      channelStatus: channels.status,
      accountId: connectedAccounts.id,
      accountStatus: connectedAccounts.status,
    })
    .from(channels)
    .innerJoin(
      connectedAccounts,
      and(
        eq(connectedAccounts.id, channels.accountId),
        eq(connectedAccounts.workspaceId, channels.workspaceId),
      ),
    )
    .where(eq(channels.workspaceId, workspaceId))
    .orderBy(asc(channels.provider), asc(channels.name));
}

/**
 * Removes a channel and, when it was the account's last one, the account and its
 * secrets. Its posts go with it (cascade), so the UI says so first. Admins only.
 */
export async function removeChannel(
  tx: Tx,
  workspaceId: string,
  channelId: string,
): Promise<boolean> {
  const removed = await tx
    .delete(channels)
    .where(and(eq(channels.id, channelId), eq(channels.workspaceId, workspaceId)))
    .returning({ accountId: channels.accountId });
  const accountId = removed[0]?.accountId;
  if (!accountId) return false;
  const left = await tx
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.accountId, accountId))
    .limit(1);
  if (left.length === 0) {
    await tx
      .delete(connectedAccounts)
      .where(
        and(eq(connectedAccounts.id, accountId), eq(connectedAccounts.workspaceId, workspaceId)),
      );
  }
  return true;
}
