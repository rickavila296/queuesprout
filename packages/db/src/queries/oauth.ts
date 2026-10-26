import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { ProviderId } from '@queuesprout/shared';
import type { Tx } from '../client';
import { oauthSessions } from '../schema/accounts';

/** One OAuth app on one server; the client secret stays encrypted until apps/web uses it. */
export interface ProviderAppRow {
  id: string;
  instanceUrl: string;
  clientId: string;
  clientSecretEnc: Buffer;
}

type AppRow = { id: string; instance_url: string; client_id: string; client_secret_enc: Buffer };
const toApp = (r: AppRow): ProviderAppRow => ({
  id: r.id,
  instanceUrl: r.instance_url,
  clientId: r.client_id,
  clientSecretEnc: r.client_secret_enc,
});

/** The app registered for this server, if any. Admins of the workspace only. */
export async function findProviderApp(
  tx: Tx,
  input: { workspaceId: string; provider: ProviderId; instanceUrl: string },
): Promise<ProviderAppRow | null> {
  const result = await tx.execute<AppRow>(sql`
    select * from app.find_provider_app(
      ${input.workspaceId}::uuid, ${input.provider}::provider_id, ${input.instanceUrl})`);
  const row = result.rows[0];
  return row ? toApp(row) : null;
}

/**
 * Stores a newly registered app and returns the one stored for this server: if another
 * request won the race, its app is returned and this one is discarded.
 */
export async function saveProviderApp(
  tx: Tx,
  input: {
    workspaceId: string;
    provider: ProviderId;
    instanceUrl: string;
    clientId: string;
    clientSecretEnc: Buffer;
    keyVersion: number;
  },
): Promise<ProviderAppRow> {
  const result = await tx.execute<AppRow>(sql`
    select * from app.save_provider_app(
      ${input.workspaceId}::uuid, ${input.provider}::provider_id, ${input.instanceUrl},
      ${input.clientId}, ${input.clientSecretEnc}::bytea, ${input.keyVersion}::smallint)`);
  const row = result.rows[0];
  if (!row) throw new Error('save_provider_app returned no row');
  return toApp(row);
}

export interface CreateOAuthSessionInput {
  stateHash: string;
  userId: string;
  workspaceId: string;
  provider: ProviderId;
  providerAppId?: string | null;
  codeVerifierEnc?: Buffer | null;
  keyVersion?: number | null;
  /** Where the callback sends the user afterwards; a path inside this app. */
  redirectTo: string;
}

/** Starts a connect flow. RLS: the caller's own row, admins only. Expires in 10 minutes. */
export async function createOAuthSession(tx: Tx, input: CreateOAuthSessionInput): Promise<string> {
  const [row] = await tx
    .insert(oauthSessions)
    .values({
      stateHash: input.stateHash,
      userId: input.userId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      providerAppId: input.providerAppId ?? null,
      codeVerifierEnc: input.codeVerifierEnc ?? null,
      keyVersion: input.keyVersion ?? null,
      redirectTo: input.redirectTo,
    })
    .returning({ id: oauthSessions.id });
  if (!row) throw new Error('could not create oauth session');
  return row.id;
}

export type ConsumedOAuthSession = typeof oauthSessions.$inferSelect;

/**
 * Marks the session for this state used and returns it, once: a replayed, expired or
 * someone else's state returns null.
 */
export async function consumeOAuthSession(
  tx: Tx,
  stateHash: string,
  now = new Date(),
): Promise<ConsumedOAuthSession | null> {
  const [row] = await tx
    .update(oauthSessions)
    .set({ consumedAt: now })
    .where(
      and(
        eq(oauthSessions.stateHash, stateHash),
        isNull(oauthSessions.consumedAt),
        gt(oauthSessions.expiresAt, now),
      ),
    )
    .returning();
  return row ?? null;
}

/** The app for a session the caller owns and has not let expire. */
export async function providerAppForSession(
  tx: Tx,
  sessionId: string,
): Promise<ProviderAppRow | null> {
  const result = await tx.execute<AppRow>(sql`
    select * from app.provider_app_for_session(${sessionId}::uuid)`);
  const row = result.rows[0];
  return row ? toApp(row) : null;
}
